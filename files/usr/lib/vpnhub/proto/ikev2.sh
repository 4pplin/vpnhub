# vpnhub - IKEv2 (strongSwan, username/password = EAP-MSCHAPv2), tunnel interface vhike
IKE_CONF=/etc/swanctl/conf.d/vpnhub-ikev2.conf

ikev2_up() { swanctl --list-sas 2>/dev/null | grep -q "vhike.*INSTALLED" && has_ip vhike; }

ikev2_start() {
	S=$(pget "$1" SERVER)
	[ -n "$S" ] || { echo "This profile has no server."; return 1; }
	cred_of "$1" || { echo "No username/password saved yet."; return 1; }
	IP=$(server_ip "$1")
	[ -n "$IP" ] || { echo "could not find the address of $S"; return 1; }
	RID=$(pget "$1" RID); [ -n "$RID" ] || RID=$S
	PR=$(pget "$1" PROPOSALS); [ -n "$PR" ] || PR="aes256gcm16-prfsha384-ecp384,aes256gcm16-prfsha256-ecp256,aes256-sha256-modp2048,aes256-sha1-modp2048,aes128-sha256-modp2048,aes256-sha1-modp1024,default"
	ES=$(pget "$1" ESP); [ -n "$ES" ] || ES="aes256gcm16-ecp384,aes256gcm16,aes256-sha256,aes256-sha1,aes128-sha1,default"
	umask 077
	cat > $IKE_CONF <<EOF
# written by vpnhub - do not edit
connections {
	vhike {
		version = 2
		remote_addrs = $IP
		vips = 0.0.0.0
		proposals = $PR
		if_id_in = 42
		if_id_out = 42
		dpd_delay = 30s
		keyingtries = 0
		local {
			auth = eap-mschapv2
			eap_id = "$CU"
		}
		remote {
			auth = pubkey
			id = $RID
		}
		children {
			vhike {
				remote_ts = 0.0.0.0/0
				esp_proposals = $ES
				start_action = start
				close_action = start
				dpd_action = restart
				updown = /usr/bin/vpnhub hook ikev2
			}
		}
	}
}
secrets {
	eap-vhike {
		id = "$CU"
		secret = "$CP"
	}
}
EOF
	chmod 600 $IKE_CONF
	/etc/init.d/swanctl stop >/dev/null 2>&1; sleep 1; /etc/init.d/swanctl start >/dev/null 2>&1
	wait_up ikev2_up
}

ikev2_stop() {
	[ -f $IKE_CONF ] || return 0
	swanctl --terminate --ike vhike >/dev/null 2>&1
	rm -f $IKE_CONF
	/etc/init.d/swanctl stop >/dev/null 2>&1
}

ikev2_log() { logread | grep "ipsec: " | tail -6 | sed 's/^.*ipsec: //'; }
