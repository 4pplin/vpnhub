#!/bin/sh
# vpnhub uninstaller.  sh uninstall.sh          removes the program, keeps your servers and settings in /etc/vpnhub
#                      sh uninstall.sh --purge  removes everything, including saved servers and passwords
# System packages (strongSwan, OpenVPN, WireGuard, ...) are left installed.
[ "$(id -u)" = 0 ] || { echo "run this as root"; exit 1; }
[ -x /usr/bin/vpnhub ] && /usr/bin/vpnhub off >/dev/null 2>&1
/etc/init.d/vpnhub disable 2>/dev/null
/etc/init.d/vpnhub-led stop >/dev/null 2>&1; /etc/init.d/vpnhub-led disable 2>/dev/null
sed -i '\#/usr/bin/vpnhub watchdog#d' /etc/crontabs/root 2>/dev/null; /etc/init.d/cron restart >/dev/null 2>&1
if [ -f /lib/upgrade/keep.d/vpnhub ]; then
	grep -vE '^/etc/(vpnhub|swanctl)/' /lib/upgrade/keep.d/vpnhub | while read -r f; do [ -f "$f" ] && rm -f "$f"; done
fi
rm -rf /usr/lib/vpnhub /usr/share/vpnhub /www/luci-static/resources/vpnhub /www/luci-static/resources/view/vpnhub
rm -f /usr/bin/vpnhub /etc/init.d/vpnhub /etc/init.d/vpnhub-ovpn /etc/init.d/vpnhub-led /etc/hotplug.d/iface/95-vpnhub /lib/upgrade/keep.d/vpnhub
rm -f /etc/strongswan.d/vpnhub.conf /etc/swanctl/conf.d/vpnhub-ikev2.conf /etc/swanctl/conf.d/vpnhub-l2tp.conf
uci -q batch <<'EOU'
delete network.vhike
delete network.vhl2tp
delete network.vhsstp
commit network
delete firewall.vpnhub
delete firewall.vpnhub_fwd
commit firewall
EOU
/etc/init.d/firewall reload >/dev/null 2>&1
/etc/init.d/network reload >/dev/null 2>&1
[ "$1" = "--purge" ] && rm -rf /etc/vpnhub
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache /var/run/vpnhub
/etc/init.d/rpcd restart >/dev/null 2>&1
echo "[vpnhub] removed."
[ -d /etc/vpnhub ] && echo "[vpnhub] your servers and settings are still in /etc/vpnhub (use --purge to delete them too)."
exit 0
