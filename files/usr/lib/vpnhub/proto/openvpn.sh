# vpnhub - OpenVPN client from the user's own .ovpn text, tunnel device vhovpn
OV_RUN=$RUN/openvpn.conf
OV_AUTH=$RUN/openvpn.auth
# options that are replaced by vpnhub, or that could run programs / write files on the router
OV_DROP='remote|remote-random|proto|dev|dev-type|dev-node|auth-user-pass|auth-nocache|up|down|route-up|route-pre-down|ipchange|tls-verify|auth-user-pass-verify|client-connect|client-disconnect|learn-address|plugin|script-security|log|log-append|daemon|writepid|status|management|redirect-gateway|route-noexec|verb|config|cd|chroot|user|group|iproute|connect-retry|setenv'
OV_DEFAULT_PORTS="udp:443 udp:80 udp:53 udp:123 udp:1194 udp:54783 tcp:443 tcp:80 tcp:1194"

openvpn_up() { has_ip vhovpn; }

# protocol:port pairs tried by the port test, besides the server's own (editable on the page)
ovpn_ports() { if [ -f $D/ovpn-ports ]; then echo $(tr ',' ' ' < $D/ovpn-ports); else echo $OV_DEFAULT_PORTS; fi; }

# ov_common <id> <udp|tcp>: the user's config text without the options vpnhub sets itself
ov_common() {
	B=$BD/$1
	[ -f "$B" ] || B=$BD/$(pget "$1" BASE)
	[ -f "$B" ] || return 1
	V=$(pget "$1" VERIFY)
	tr -d '\r' < "$B" | grep -vE "^[[:space:]]*($OV_DROP)([[:space:]]|\$)" \
		| { if [ -n "$V" ]; then grep -vE '^[[:space:]]*verify-x509-name([[:space:]]|$)'; else cat; fi; } \
		| { case "$2" in tcp*) grep -vE '^[[:space:]]*explicit-exit-notify([[:space:]]|$)' ;; *) cat ;; esac; }
	echo
	case "$2" in tcp*) echo "proto tcp-client" ;; *) echo "proto udp" ;; esac
	[ -n "$V" ] && echo "verify-x509-name $V name"
	return 0
}

# openvpn_build <id>: writes the runtime config
openvpn_build() {
	S=$(pget "$1" SERVER)
	[ -n "$S" ] || { echo "No server address found in the config."; return 1; }
	IPS=$(server_ips "$1")
	[ -n "$IPS" ] || { echo "could not find the address of $S"; return 1; }
	PO=$(pget "$1" PORT); PT=$(pget "$1" PROTO)
	umask 077
	ov_common "$1" "${PT:-udp}" > $OV_RUN || { echo "This profile has no OpenVPN config text."; return 1; }
	{
		# every address of the server; OpenVPN moves on to the next one by itself when one does not answer
		for IP in $IPS; do echo "remote $IP ${PO:-1194}"; done
		echo "server-poll-timeout 10"
		if cred_of "$1"; then
			printf '%s\n%s\n' "$CU" "$CP" > $OV_AUTH; chmod 600 $OV_AUTH
			echo "auth-user-pass $OV_AUTH"
			echo "auth-nocache"
		fi
		echo "dev vhovpn"
		echo "dev-type tun"
		echo "route-noexec"
		echo "pull-filter ignore redirect-gateway"
		echo "pull-filter ignore dhcp-option"
		echo "pull-filter ignore block-outside-dns"
		echo "connect-retry 5 30"
		echo "verb 2"
		echo "script-security 2"
		echo 'up "/usr/bin/vpnhub hook openvpn up"'
		echo 'down "/usr/bin/vpnhub hook openvpn down"'
	} >> $OV_RUN
	chmod 600 $OV_RUN
}

openvpn_start() {
	openvpn_build "$1" || return 1
	/etc/init.d/vpnhub-ovpn stop >/dev/null 2>&1; sleep 1; ip link del vhovpn 2>/dev/null
	/etc/init.d/vpnhub-ovpn start >/dev/null 2>&1
	wait_up openvpn_up
}

openvpn_stop() {
	/etc/init.d/vpnhub-ovpn stop >/dev/null 2>&1
	ip link del vhovpn 2>/dev/null
	rm -f $OV_RUN $OV_AUTH
	return 0
}

openvpn_log() { logread | grep "openvpn" | tail -6 | sed 's/^.*openvpn[^:]*: //'; }

# openvpn_parse <body file>: prints "server port proto" taken from the config text
openvpn_parse() {
	tr -d '\r' < "$1" | awk '
		$1=="proto" && pr=="" { pr=$2 }
		$1=="remote" && s=="" { s=$2; if ($3 != "") po=$3; if ($4 != "") rp=$4 }
		END { if (rp != "") pr=rp; if (pr=="") pr="udp"; if (po=="") po="1194"; sub(/-client$/,"",pr); sub(/[46]$/,"",pr); print s, po, pr }'
}

# ov_one <dir> <ip> <proto:port>: one real TLS handshake on that protocol and port, without any tunnel device.
# Leaves <dir>/ok.<proto>-<port> when the server answered (even if it then refused the login).
ov_one() {
	pr=${3%%:*}; po=${3##*:}; lg=$1/$pr-$po.log
	openvpn --config "$1/$pr.conf" --remote "$2" "$po" --auth-user-pass "$1/auth" --auth-nocache --dev null \
		--ifconfig-noexec --route-noexec --connect-retry-max 1 --connect-timeout 5 --server-poll-timeout 5 \
		--verb 3 --log "$lg" >/dev/null 2>&1 &
	pid=$!
	i=0
	while [ $i -lt 7 ]; do
		sleep 1
		grep -qE "Peer Connection Initiated|AUTH_FAILED|Initialization Sequence Completed" "$lg" 2>/dev/null && { : > "$1/ok.$pr-$po"; break; }
		kill -0 $pid 2>/dev/null || break
		i=$((i + 1))
	done
	kill $pid 2>/dev/null; sleep 1; kill -9 $pid 2>/dev/null
}

# openvpn_porttest <id>: which protocol:port pairs answer for this server. The running tunnel is not touched.
# Prints "ports=<id>|<open pairs, comma separated>|<pair now set>"
openvpn_porttest() {
	ID=$1
	OP=$(pget "$ID" PORT); OT=$(pget "$ID" PROTO)
	case "$OT" in tcp*) OT=tcp ;; *) OT=udp ;; esac
	OWN="$OT:${OP:-1194}"
	if [ "$ID" = "$(active)" ]; then echo "ports=$ID|active|$OWN"; return 0; fi
	IPS=$(server_ips "$ID")
	X=$RUN/ovtest.$ID; rm -rf $X; mkdir -p $X; chmod 700 $X
	umask 077
	if [ -z "$IPS" ] || ! ov_common "$ID" udp > $X/udp.conf || ! ov_common "$ID" tcp > $X/tcp.conf; then rm -rf $X; echo "ports=$ID|error|$OWN"; return 1; fi
	if cred_of "$ID"; then printf '%s\n%s\n' "$CU" "$CP" > $X/auth; else printf 'vpnhub-test\nvpnhub-test\n' > $X/auth; fi
	LIST=""
	for c in $OWN $(ovpn_ports); do
		echo "$c" | grep -qE '^(udp|tcp):[0-9]+$' || continue
		case " $LIST " in *" $c "*) ;; *) LIST="$LIST $c" ;; esac
	done
	OK=""
	for IP in $IPS; do
		# two rounds: a pair that did not answer the first time gets one more chance before it counts as closed
		for round in 1 2; do
			n=0
			for c in $LIST; do
				[ -f "$X/ok.${c%%:*}-${c##*:}" ] && continue
				ov_one $X "$IP" "$c" &
				n=$((n + 1))
				[ $((n % 4)) = 0 ] && wait
			done
			wait
		done
		for c in $LIST; do [ -f "$X/ok.${c%%:*}-${c##*:}" ] && OK="$OK $c"; done
		# nothing at all from this address: the machine behind it may be down, try the server's next address
		[ -n "$OK" ] && break
	done
	rm -rf $X
	if [ -n "$OK" ]; then
		case " $OK " in *" $OWN "*) ;; *)
			OWN=$(echo $OK | cut -d' ' -f1)
			sed -i -e "s/^PORT=.*/PORT=${OWN##*:}/" -e "s/^PROTO=.*/PROTO=${OWN%%:*}/" "$PD/$ID" ;;
		esac
	fi
	echo "ports=$ID|$(echo $OK | tr ' ' ',')|$OWN"
}
