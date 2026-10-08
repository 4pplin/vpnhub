# vpnhub - AmneziaWG (WireGuard with traffic masking) from the user's own .conf text, tunnel device vhawg
# Needs kmod-amneziawg and amneziawg-tools; uses the wgx_* helpers from wireguard.sh
amneziawg_up() { wgx_up vhawg awg; }
amneziawg_start() { wgx_start vhawg awg amneziawg "$1"; }
amneziawg_stop() { ip link del vhawg 2>/dev/null; rm -f $RUN/amneziawg.conf; return 0; }
amneziawg_log() { awg show vhawg 2>/dev/null | grep -E "endpoint|handshake|transfer"; }
amneziawg_parse() { wireguard_parse "$1"; }
