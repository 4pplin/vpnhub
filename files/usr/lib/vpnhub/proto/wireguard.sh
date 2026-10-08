# vpnhub - WireGuard client from the user's own .conf text, tunnel device vhwg.
# The wgx_* helpers are shared with AmneziaWG.
WG_DEFAULT_PORTS="80 65142 443 53 123 1194"

wgx_up() {
	has_ip "$1" || return 1
	h=$($2 show "$1" latest-handshakes 2>/dev/null | awk '{print $2}' | sort -n | tail -1)
	[ -n "$h" ] && [ "$h" -gt 0 ] && [ $(( $(date +%s) - h )) -lt 190 ]
}

# wireguard_parse <body file>: prints "host port" of the first Endpoint
wireguard_parse() {
	tr -d '\r' < "$1" | sed -n 's/^[[:space:]]*[Ee]ndpoint[[:space:]]*=[[:space:]]*//p' | head -1 | sed 's/^\[\(.*\)\]:/\1 /; s/:\([0-9]*\)[[:space:]]*$/ \1/'
}

# extra ports that are tried when a server does not answer on its own port (editable on the page)
wg_ports() { if [ -f $D/wg-ports ]; then echo $(tr "," " " < $D/wg-ports); else echo $WG_DEFAULT_PORTS; fi; }

# wgx_portlist <id>: ports to try, in order: the server's own port, the port that worked last time, then the extra ports
wgx_portlist() {
	own=$(pget "$1" PORT); out=""
	for p in ${own:-51820} $(cat $D/wg-port.last 2>/dev/null) $(wg_ports); do
		case " $out " in *" $p "*) ;; *) out="$out $p" ;; esac
	done
	echo $out
}

# wgx_addrs <id>: a server name can stand for several machines and one of them may be down: a few addresses to try
wgx_addrs() {
	S=$(pget "$1" SERVER); c=""
	for q in 1 2 3; do
		a=$(resolve "$S")
		[ -n "$a" ] && case " $c " in *" $a "*) ;; *) c="$c $a" ;; esac
		is_ip "$S" && break
	done
	[ -n "$c" ] || c=$(pget "$1" IP)
	echo $c
}

# wgx_conf <body> <ip:port>: writes $WG_RUN with only what "setconf" understands. The endpoint is replaced by the
# given address, and the personal key (see "vpnhub account wireguard") fills in for servers that carry none.
wgx_conf() {
	ACC=$D/account.wireguard
	tr -d '\r' < "$1" | awk -v EP="$2" -v AWG="$([ "$WLINK" = amneziawg ] && echo 1)" \
		-v PK="$(sed -n 1p $ACC 2>/dev/null)" -v PSK="$(sed -n 3p $ACC 2>/dev/null)" '
		function flush() {
			if (sec == "interface" && !spk && PK != "") print "PrivateKey = " PK
			if (sec == "peer" && !spsk && PSK != "") print "PresharedKey = " PSK
			if (sec == "peer" && !ska) print "PersistentKeepalive = 25"
		}
		/^[[:space:]]*\[/ { flush(); sec = tolower($0); gsub(/[^a-z]/, "", sec); spk = 0; spsk = 0; ska = 0; print; next }
		/^[[:space:]]*(#|;|$)/ { next }
		{
			k = tolower($0); sub(/[[:space:]]*=.*/, "", k); gsub(/[[:space:]]/, "", k)
			if (sec == "interface") {
				if (k == "privatekey") spk = 1
				if (k == "privatekey" || k == "listenport" || k == "fwmark" || (AWG == 1 && k ~ /^(jc|jmin|jmax|s[1-4]|h[1-4]|i[1-5]|j[1-3]|itime)$/)) print
				next
			}
			if (sec == "peer") {
				if (k == "endpoint") { print "Endpoint = " EP; next }
				if (k == "persistentkeepalive") ska = 1
				if (k == "presharedkey") spsk = 1
				if (k == "publickey" || k == "presharedkey" || k == "allowedips" || k == "persistentkeepalive") print
			}
		}
		END { flush() }' > $WG_RUN
	chmod 600 $WG_RUN
}

# wgx_link <id>: creates $WDEV with the tunnel address. Needs WDEV WTOOL WLINK WG_RUN set.
wgx_link() {
	B=$BD/$1
	[ -f "$B" ] || { echo "This profile has no config text."; return 1; }
	ACC=$D/account.wireguard
	ADDRS=$(tr -d '\r' < "$B" | sed -n 's/^[[:space:]]*[Aa]ddress[[:space:]]*=[[:space:]]*//p' | tr ',' '\n' | tr -d ' ' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$')
	[ -n "$ADDRS" ] || ADDRS=$(sed -n 2p $ACC 2>/dev/null | tr ',' '\n' | tr -d ' ' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$')
	[ -n "$ADDRS" ] || { echo "No tunnel address: fill in the personal key section of the WireGuard page."; return 1; }
	wgx_conf "$B" "192.0.2.1:9"
	grep -qi '^PrivateKey' $WG_RUN || { echo "No private key: fill in the personal key section of the WireGuard page."; return 1; }
	MTU=$(tr -d '\r' < "$B" | sed -n 's/^[[:space:]]*[Mm][Tt][Uu][[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
	ip link del $WDEV 2>/dev/null
	ip link add $WDEV type $WLINK || { echo "This router cannot create a $WLINK interface (kernel module missing?)."; return 1; }
	for a in $ADDRS; do ip addr add "$a" dev $WDEV; done
	ip link set $WDEV mtu "${MTU:-1380}" up
}

# wgx_try <id> <ip> <port> <tries>: points the link at one address and port and waits for a handshake (about 1 s per try)
wgx_try() {
	wgx_conf "$BD/$1" "$2:$3"
	# forget the previous attempt completely, so an old handshake is never counted for the new address or port
	for k in $($WTOOL show $WDEV peers 2>/dev/null); do $WTOOL set $WDEV peer "$k" remove 2>/dev/null; done
	$WTOOL setconf $WDEV $WG_RUN 2>/dev/null || return 2
	w=0
	while [ $w -lt "$4" ]; do
		# a handshake only happens when there is traffic
		ping -c 1 -W 1 -I $WDEV 1.1.1.1 >/dev/null 2>&1
		h=$($WTOOL show $WDEV latest-handshakes 2>/dev/null | awk '{print $2}' | sort -n | tail -1)
		[ -n "$h" ] && [ "$h" -gt 0 ] && return 0
		w=$((w + 1))
	done
	return 1
}

wgx_start() {
	WDEV=$1; WTOOL=$2; WLINK=$3; WG_RUN=$RUN/$3.conf; ID=$4
	[ -n "$(pget "$ID" SERVER)" ] || { echo "No Endpoint found in the config."; return 1; }
	CAND=$(wgx_addrs "$ID")
	[ -n "$CAND" ] || { echo "could not find the address of $(pget "$ID" SERVER)"; return 1; }
	umask 077
	wgx_link "$ID" || return 1
	OWN=$(pget "$ID" PORT); OWN=${OWN:-51820}
	PORTS=$(wgx_portlist "$ID")
	# while the "ping to target" test walks through many servers, do not spend long on one that is down
	[ -f $PROBING ] && PORTS=$(echo $PORTS | cut -d' ' -f1-2)
	TR=5
	for P in $PORTS; do
		for IP in $CAND; do
			if wgx_try "$ID" "$IP" "$P" $TR; then
				echo "$P" > $D/wg-port.last
				if [ "$P" != "$OWN" ]; then
					sed -i "s/^PORT=.*/PORT=$P/" "$PD/$ID"
					say "$WLINK: $(pget "$ID" SERVER) answered on port $P instead of $OWN; remembered for next time"
				fi
				return 0
			fi
			TR=3
		done
	done
	return 1
}

# wgx_porttest <slot> <id>: which of the candidate ports answer for this server. Uses its own test link, so the
# running tunnel is not touched. Prints "ports=<id>|<open ports, comma separated>|<port now set>"
wgx_porttest() {
	ID=$2; T=$(pget "$ID" TYPE)
	if [ "$T" = amneziawg ]; then WTOOL=awg; WLINK=amneziawg; else WTOOL=wg; WLINK=wireguard; fi
	WDEV=vhpt$1; WG_RUN=$RUN/porttest$1.conf
	OWN=$(pget "$ID" PORT); OWN=${OWN:-51820}
	if [ "$ID" = "$(active)" ]; then echo "ports=$ID|active|$OWN"; return 0; fi
	CAND=$(wgx_addrs "$ID")
	umask 077
	if [ -z "$CAND" ] || ! wgx_link "$ID" >/dev/null 2>&1; then echo "ports=$ID|error|$OWN"; ip link del $WDEV 2>/dev/null; return 1; fi
	OK=""; GOOD=""
	for P in $(wgx_portlist "$ID"); do
		for IP in ${GOOD:-$CAND}; do
			if wgx_try "$ID" "$IP" "$P" 3; then OK="$OK $P"; GOOD=$IP; break; fi
		done
	done
	ip link del $WDEV 2>/dev/null; rm -f $WG_RUN
	if [ -n "$OK" ]; then
		case " $OK " in *" $OWN "*) ;; *) OWN=$(echo $OK | cut -d' ' -f1); sed -i "s/^PORT=.*/PORT=$OWN/" "$PD/$ID" ;; esac
	fi
	echo "ports=$ID|$(echo $OK | tr ' ' ',')|$OWN"
}

wireguard_up() { wgx_up vhwg wg; }
wireguard_start() { wgx_start vhwg wg wireguard "$1"; }
wireguard_stop() { ip link del vhwg 2>/dev/null; rm -f $RUN/wireguard.conf; return 0; }
wireguard_log() { wg show vhwg 2>/dev/null | grep -E "endpoint|handshake|transfer"; }
