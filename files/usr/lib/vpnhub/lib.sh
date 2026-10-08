# vpnhub - shared helpers (sourced by /usr/bin/vpnhub)
D=/etc/vpnhub
PD=$D/profiles
BD=$D/bodies
RUN=/var/run/vpnhub
PROBING=/tmp/vpnhub-probing
STAMP=/tmp/vpnhub-retry.last
TYPES="ikev2 l2tp openvpn wireguard amneziawg sstp"
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
	esac
}
wan_dev() { ip -4 route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1; }
lan_dev() { d=$(ifstatus lan 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null); echo "${d:-br-lan}"; }
lan_net() { ip -4 route show dev "$(lan_dev)" scope link 2>/dev/null | awk '{print $1}' | head -1; }
has_ip() { ip -4 addr show "$1" 2>/dev/null | grep -q "inet "; }
dev_ip() { ip -4 addr show "$1" 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1; }
is_ip() { echo "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; }

# resolve <host>: real address of a server. DNS-over-HTTPS first (plain DNS answers are often forged), then the normal resolver.
resolve() {
	if is_ip "$1"; then echo "$1"; return; fi
	r=$(curl -s -m 10 -H 'accept: application/dns-json' "https://1.1.1.1/dns-query?name=$1&type=A" 2>/dev/null | grep -o '"data":"[0-9.]*"' | head -1 | sed 's/[^0-9.]//g')
	[ -n "$r" ] || r=$(curl -s -m 10 "https://dns.google/resolve?name=$1&type=A" 2>/dev/null | grep -o '"data":"[0-9.]*"' | head -1 | sed 's/[^0-9.]//g')
	[ -n "$r" ] || r=$(nslookup "$1" 127.0.0.1 2>/dev/null | sed -n 's/^Address\( [0-9]*\)*: \([0-9.]*\)$/\2/p' | grep -v '^127\.' | head -1)
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
		a=$(resolve "$sn")
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

b64enc() { if command -v base64 >/dev/null 2>&1; then base64; else openssl base64; fi; }
b64dec() { if command -v base64 >/dev/null 2>&1; then base64 -d; else openssl base64 -d; fi; }

badchars() { case "$1" in *'"'*|*'\'*) return 0 ;; esac; return 1; }
