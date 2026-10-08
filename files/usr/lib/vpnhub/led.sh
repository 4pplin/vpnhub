#!/bin/sh
# vpnhub - optional status light. Off unless switched on in the settings page (/etc/vpnhub/led).
#   led.sh run            keep the light in step with the tunnel (started by /etc/init.d/vpnhub-led)
#   led.sh show <state>   show one state now: vpn-americas | vpn-other | direct | nonet | attention
#   led.sh restore        give the light(s) back to the router's own control
#
# Three-colour light (LED_MODE=rgb):           One plain light (LED_MODE=single):
#   purple, steady  = tunnel, exit in America    on, steady  = tunnel in use
#   blue, steady    = tunnel, exit elsewhere     off         = direct, no tunnel
#   red, steady     = direct, no tunnel          fast blink  = no internet from the modem
#   green, blinking = no internet from the modem slow blink  = needs attention
#   yellow, blinking= needs attention (tunnel wanted but down for 3 minutes, or names are not resolving)
. /usr/lib/vpnhub/lib.sh
. /usr/lib/vpnhub/route.sh
L=/sys/class/leds
SAVED=$RUN/led.saved
LED_MODE=off; LED_R=""; LED_G=""; LED_B=""; LED_ONE=""
[ -f $D/led ] && . $D/led

leds() { if [ "$LED_MODE" = rgb ]; then echo $LED_R $LED_G $LED_B; else echo $LED_ONE; fi; }

# lset <led> <0-255> <0|slow|fast>
lset() {
	[ -n "$1" ] && [ -d "$L/$1" ] || return 0
	m=$(cat "$L/$1/max_brightness" 2>/dev/null); m=${m:-255}
	v=$(( $2 * m / 255 )); [ "$2" -gt 0 ] && [ $v = 0 ] && v=1
	echo none > "$L/$1/trigger" 2>/dev/null
	echo $v > "$L/$1/brightness" 2>/dev/null
	if [ "$3" != 0 ] && [ $v -gt 0 ]; then
		d=1000; [ "$3" = fast ] && d=200
		echo timer > "$L/$1/trigger" 2>/dev/null
		echo $d > "$L/$1/delay_on" 2>/dev/null; echo $d > "$L/$1/delay_off" 2>/dev/null
	fi
}

show() {
	if [ "$LED_MODE" = rgb ]; then
		case "$1" in
			vpn-americas) set -- 160 0 255 0 ;;
			vpn-other) set -- 0 0 255 0 ;;
			direct) set -- 255 0 0 0 ;;
			nonet) set -- 90 255 20 slow ;;
			attention) set -- 255 150 0 slow ;;
			*) return 0 ;;
		esac
		lset "$LED_R" $1 $4; lset "$LED_G" $2 $4; lset "$LED_B" $3 $4
	else
		case "$1" in
			vpn-americas|vpn-other) lset "$LED_ONE" 255 0 ;;
			direct) lset "$LED_ONE" 0 0 ;;
			nonet) lset "$LED_ONE" 255 fast ;;
			attention) lset "$LED_ONE" 255 slow ;;
		esac
	fi
}

save_state() {
	[ -f $SAVED ] && return 0
	for l in $(leds); do
		[ -d "$L/$l" ] || continue
		t=$(sed 's/.*\[\(.*\)\].*/\1/' "$L/$l/trigger" 2>/dev/null)
		echo "$l ${t:-none} $(cat "$L/$l/brightness" 2>/dev/null)"
	done > $SAVED
}
restore_state() {
	[ -f $SAVED ] || return 0
	while read -r l t b; do
		[ -d "$L/$l" ] || continue
		echo none > "$L/$l/trigger" 2>/dev/null
		echo "${b:-0}" > "$L/$l/brightness" 2>/dev/null
		[ "$t" = none ] || echo "$t" > "$L/$l/trigger" 2>/dev/null
	done < $SAVED
	rm -f $SAVED
}

AMERICAS=" US CA MX BR AR CL CO PE VE EC UY PY BO CR PA GT DO PR CU JM TT HN NI SV BS BZ GY SR HT "
exit_country() {
	# country of the tunnel exit, asked through the tunnel itself and remembered per server
	key="$LDEV $LID $(dev_ip "$LDEV")"
	if [ "$(sed -n 1p /tmp/vpnhub-exit 2>/dev/null)" = "$key" ]; then sed -n 2p /tmp/vpnhub-exit; return; fi
	cc=$(curl -s -m 6 --interface "$LDEV" https://1.1.1.1/cdn-cgi/trace 2>/dev/null | sed -n 's/^loc=//p')
	[ -n "$cc" ] && printf '%s\n%s\n' "$key" "$cc" > /tmp/vpnhub-exit
	echo "$cc"
}
net_ok() { W=$(wan_dev); for t in 1.1.1.1 178.22.122.100 8.8.8.8; do ping -c 1 -W 2 ${W:+-I $W} $t >/dev/null 2>&1 && return 0; done; return 1; }
dns_ok() { nslookup -timeout=3 openwrt.org 127.0.0.1 >/dev/null 2>&1 || nslookup -timeout=3 aparat.com 127.0.0.1 >/dev/null 2>&1; }

case "$1" in
	show) save_state; show "$2" ;;
	restore) restore_state ;;
	run)
		case "$LED_MODE" in rgb|single) ;; *) exit 0 ;; esac
		[ -n "$(leds)" ] || exit 0
		save_state
		netfail=0; dnsfail=0; downsince=0; n=0; cur=""; new=""
		while :; do
			n=$((n + 1)); now=$(date +%s)
			LID=$(active); LT=$(pget "$LID" TYPE); LDEV=$(dev_of "$LT")
			wanted=0; [ -n "$LT" ] && [ ! -f $PROBING ] && wanted=1
			vpn=0; [ -n "$LDEV" ] && has_rules && has_ip "$LDEV" && vpn=1
			if net_ok; then
				netfail=0
				if [ $vpn = 1 ]; then downsince=0; else [ $downsince = 0 ] && downsince=$now; fi
				if [ $((n % 3)) = 0 ]; then if dns_ok; then dnsfail=0; else dnsfail=$((dnsfail + 1)); fi; fi
				if [ $wanted = 1 ] && [ $vpn = 0 ] && [ $((now - downsince)) -ge 180 ]; then new=attention
				elif [ $dnsfail -ge 2 ]; then new=attention
				elif [ $vpn = 1 ]; then
					cc=$(exit_country)
					case "$AMERICAS" in *" $cc "*) new=vpn-americas ;; *) new=vpn-other ;; esac
					[ -n "$cc" ] || new=vpn-other
				else new=direct; fi
			else
				netfail=$((netfail + 1))
				[ $netfail -ge 2 ] && new=nonet
			fi
			if [ -n "$new" ] && [ "$new" != "$cur" ]; then
				show "$new"; cur=$new
				say "light: $new $(sed -n 2p /tmp/vpnhub-exit 2>/dev/null)"
			fi
			sleep 10
		done ;;
esac
exit 0
