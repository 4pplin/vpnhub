# vpnhub - shared helpers (sourced by /usr/bin/vpnhub)
D=/etc/vpnhub
PD=$D/profiles
BD=$D/bodies
RUN=/var/run/vpnhub
PROBING=/tmp/vpnhub-probing
STAMP=/tmp/vpnhub-retry.last
TYPES="ikev2 l2tp openvpn wireguard amneziawg sstp v2ray"
VH_WAIT=${VH_WAIT:-15}
mkdir -p $PD $BD $RUN 2>/dev/null
chmod 700 $D $PD $BD $RUN 2>/dev/null

say() { logger -t vpnhub "$*"; }
pget() { sed -n "s/^$2=//p" "$PD/$1" 2>/dev/null | head -1; }
okid() { printf '%s' "$1" | grep -E '^[a-z0-9]+$'; }
oktype() { case " $TYPES " in *" $1 "*) echo "$1" ;; esac; }
active() { cat $D/active 2>/dev/null; }
active_type() { a=$(active); [ -n "$a" ] && pget "$a" TYPE; }
dev_of() {
	case "$1" in
		ikev2) echo vhike ;;
		l2tp) echo l2tp-vhl2tp ;;
		openvpn) echo vhovpn ;;
		wireguard) echo vhwg ;;
		amneziawg) echo vhawg ;;
		sstp) echo sstp-vhsstp ;;
		v2ray) echo vhsb ;;
	esac
}
tool_of() {
	case "$1" in
		ikev2) echo swanctl ;;
		l2tp) echo xl2tpd ;;
		openvpn) echo openvpn ;;
		wireguard) echo wg ;;
		amneziawg) echo awg ;;
		sstp) echo sstpc ;;
		v2ray) echo sing-box ;;
	esac
}
wan_dev() { ip -4 route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1; }
lan_dev() { d=$(ifstatus lan 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null); echo "${d:-br-lan}"; }
lan_net() { ip -4 route show dev "$(lan_dev)" scope link 2>/dev/null | awk '{print $1}' | head -1; }
has_ip() { ip -4 addr show "$1" 2>/dev/null | grep -q "inet "; }
dev_ip() { ip -4 addr show "$1" 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1; }
is_ip() { echo "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; }

# resolve <host>: real address of a server. DNS-over-HTTPS first (plain DNS answers are often forged), then the normal resolver.
# resolve <name> [fresh]: an IPv4 address of the name, asked over DNS-over-HTTPS first (a forged local answer cannot spoil it).
# Answers are kept 10 minutes ("fresh" skips that), and a DoH service that does not answer at all (filtered on some direct
# lines) is skipped for 10 minutes: before, every lookup waited 10 + 10 seconds for both, so adding a subscription with many
# servers ran for many minutes and every tunnel start lost up to 20 seconds
RC=/tmp/vpnhub-dns
resolve() {
	if is_ip "$1"; then echo "$1"; return; fi
	mkdir -p $RC 2>/dev/null
	rf=$RC/$(printf '%s' "$1" | tr -c 'A-Za-z0-9.-' '_')
	if [ "$2" != fresh ] && [ -s "$rf" ] && [ $(( $(date +%s) - $(date -r "$rf" +%s) )) -lt 600 ]; then cat "$rf"; return; fi
	r=""
	# Google's service asked by address first: on filtered lines the name dns.google and 1.1.1.1 do not answer, 8.8.8.8 does
	for u in "https://8.8.8.8/resolve?name=$1&type=A" "https://8.8.4.4/resolve?name=$1&type=A" "https://1.1.1.1/dns-query?name=$1&type=A" "https://dns.google/resolve?name=$1&type=A"; do
		dk=$RC/.dead.$(echo "$u" | cut -d/ -f3)
		[ -f "$dk" ] && [ $(( $(date +%s) - $(date -r "$dk" +%s) )) -lt 600 ] && continue
		o=$(curl -s -m 4 -H 'accept: application/dns-json' "$u" 2>/dev/null)
		[ -n "$o" ] || { touch "$dk"; continue; }
		rm -f "$dk"
		r=$(echo "$o" | grep -o '"data":"[0-9.]*"' | head -1 | sed 's/[^0-9.]//g')
		[ -n "$r" ] && break
	done
	[ -n "$r" ] || r=$(nslookup "$1" 127.0.0.1 2>/dev/null | sed -n 's/^Address\( [0-9]*\)*: \([0-9.]*\)$/\2/p' | grep -v '^127\.' | head -1)
	[ -n "$r" ] && echo "$r" > "$rf"
	echo "$r"
}

# server_ip <id>: fresh address of the profile's server, or the one remembered when the profile was saved
server_ip() {
	r=$(resolve "$(pget "$1" SERVER)")
	[ -n "$r" ] || r=$(pget "$1" IP)
	echo "$r"
}

# server_ips <id>: a server name can stand for several machines and one of them may be down: a few addresses to try
server_ips() {
	sn=$(pget "$1" SERVER); c=""
	for q in 1 2 3; do
		a=$(resolve "$sn" fresh)
		[ -n "$a" ] && case " $c " in *" $a "*) ;; *) c="$c $a" ;; esac
		is_ip "$sn" && break
	done
	[ -n "$c" ] || c=$(pget "$1" IP)
	echo $c
}

# cred_of <id>: sets CU / CP from the profile, or from the default account of its type
cred_of() {
	CU=$(pget "$1" USER); CP=$(pget "$1" PASS)
	if [ -z "$CU" ]; then
		f=$D/account.$(pget "$1" TYPE)
		CU=$(sed -n 1p "$f" 2>/dev/null); CP=$(sed -n 2p "$f" 2>/dev/null)
	fi
	[ -n "$CU" ] && [ -n "$CP" ]
}

# wait_up <test command...>: polls up to VH_WAIT x 2 seconds
wait_up() {
	w=0
	while [ $w -lt "$VH_WAIT" ]; do
		sleep 2
		"$@" && return 0
		w=$((w + 1))
	done
	"$@"
}

# real_ms <device>: round trip through a tunnel in ms, best of three, empty when nothing passes. It times one HTTP request
# after the connection is open, so proxy tunnels (V2Ray), whose own end answers the TCP handshake at once, are timed truly too
# xray_ms <id> <port>: start Xray for one V2Ray server on a local SOCKS port, nothing else; then three requests over one
# connection: the first opens the way, the next two are pure round trips through the server, the faster one is the delay
xray_ms() {
	c=/tmp/vpnhub-xt.$2.json
	ucode /usr/lib/vpnhub/v2link.uc xconf "$BD/$1" "$(pget "$1" IP)" "$2" > $c 2>/dev/null || { rm -f $c; return 2; }
	xray run -c $c >/dev/null 2>&1 &
	xp=$!
	# (BusyBox sleep takes whole seconds only)
	w=0; while [ $w -lt 8 ] && ! netstat -ltn 2>/dev/null | grep -q "127.0.0.1:$2 "; do sleep 1; w=$((w + 1)); done
	# only real answers count (http code 2xx/3xx), not a refused or empty one
	curl -s -m 8 -o /dev/null -x "socks5h://127.0.0.1:$2" -w '%{http_code} %{time_starttransfer}\n' http://1.1.1.1/ http://1.1.1.1/ http://1.1.1.1/ 2>/dev/null \
		| awk 'NR > 1 && $1 ~ /^[23]/ { v = int($2 * 1000); if (b == "" || v < b) b = v } END { if (b != "") print (b > 0 ? b : 1) }'
	kill $xp 2>/dev/null; wait $xp 2>/dev/null; rm -f $c
}

real_ms() {
	b=""
	for i in 1 2 3; do
		ms=$(curl -s -m 6 -o /dev/null --interface "$1" -w '%{time_connect} %{time_starttransfer}' http://1.1.1.1/ 2>/dev/null \
			| awk '$2 > 0 { printf "%d", ($2 - $1) * 1000 }')
		[ -n "$ms" ] || continue
		[ "$ms" -gt 0 ] || ms=1
		if [ -z "$b" ] || [ "$ms" -lt "$b" ]; then b=$ms; fi
	done
	echo "$b"
}

b64enc() { if command -v base64 >/dev/null 2>&1; then base64; else openssl base64; fi; }
b64dec() { if command -v base64 >/dev/null 2>&1; then base64 -d; else openssl base64 -d; fi; }

# norm_ents: one item per line from whatever was typed. A whole web address ("https://www.example.com/page?x=1") becomes
# the bare site name ("example.com"); addresses and address ranges are left as they are.
norm_ents() {
	tr ', ' '\n\n' | tr -d '\r\t' | awk '
		$0 == "" { next }
		/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ { print; next }
		{
			x = tolower($0)
			sub(/^[a-z][a-z0-9+.-]*:\/\//, "", x); sub(/[\/?#].*$/, "", x); sub(/^.*@/, "", x); sub(/:[0-9]+$/, "", x)
			sub(/^\*\./, "", x); sub(/^www\./, "", x); sub(/\.$/, "", x)
			if (x != "") print x
		}'
}

badchars() { case "$1" in *'"'*|*'\'*) return 0 ;; esac; return 1; }
