# vpnhub - L2TP, plain or over IPsec (pre-shared key), network interface vhl2tp (device l2tp-vhl2tp)
L2_CONF=/etc/swanctl/conf.d/vpnhub-l2tp.conf

l2tp_up() { ifstatus vhl2tp 2>/dev/null | grep -q '"up": true'; }

l2tp_start() {
	S=$(pget "$1" SERVER)
	[ -n "$S" ] || { echo "This profile has no server."; return 1; }
	cred_of "$1" || { echo "No username/password saved yet."; return 1; }
	IP=$(server_ip "$1")
	[ -n "$IP" ] || { echo "could not find the address of $S"; return 1; }
	ifdown vhl2tp 2>/dev/null
	K=$(pget "$1" PSK)
	if [ "$(pget "$1" IPSEC)" = 1 ] && [ -n "$K" ]; then
		umask 077
		cat > $L2_CONF <<EOF
# written by vpnhub - do not edit
connections {
	vhl2tp {
		version = 1
		remote_addrs = $IP
		proposals = aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,aes256-sha256-modp2048,aes128-sha256-modp2048,aes256-sha1-modp2048,aes128-sha1-modp2048
		dpd_delay = 30s
		local {
			auth = psk
		}
		remote {
			auth = psk
		}
		children {
			vhl2tp {
				mode = transport
				local_ts = dynamic[udp/1701]
				remote_ts = dynamic[udp/1701]
				esp_proposals = aes256-sha1,aes128-sha1,3des-sha1,aes256-sha256,aes128-sha256
				start_action = trap
				dpd_action = restart
			}
		}
	}
}
secrets {
	ike-vhl2tp {
		id = $IP
		secret = "$K"
	}
}
EOF
		chmod 600 $L2_CONF
		/etc/init.d/swanctl stop >/dev/null 2>&1; sleep 1; /etc/init.d/swanctl start >/dev/null 2>&1
		sleep 3
	else
		rm -f $L2_CONF
	fi
	uci -q get network.vhl2tp >/dev/null || { echo "The L2TP interface is missing; run the installer again."; return 1; }
	uci set network.vhl2tp.server="$IP"
	uci set network.vhl2tp.username="$CU"
	uci set network.vhl2tp.password="$CP"
	uci commit network
	ubus call network reload >/dev/null 2>&1
	sleep 1
	ifup vhl2tp
	wait_up l2tp_up
}

l2tp_stop() {
	ifdown vhl2tp 2>/dev/null
	if [ -f $L2_CONF ]; then
		swanctl --terminate --ike vhl2tp >/dev/null 2>&1
		rm -f $L2_CONF
		/etc/init.d/swanctl stop >/dev/null 2>&1
	fi
	return 0
}

l2tp_log() { logread | grep -E "xl2tpd|pppd|ipsec: " | tail -8 | sed 's/^.*daemon\.[a-z]* //'; }
