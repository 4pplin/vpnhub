'use strict';
'require baseclass';
'require view';
'require fs';
'require poll';
'require ui';
'require vpnhub.world as world';
'require vpnhub.page as page';

/* vpnhub - the two dashboards.
   home: the router in the middle, every live device around it, where the internet leaves from above it, router health below.
   hub:  the world with every server of the open tunnel type as a dot, the live one lit and joined to home; under it one tab
         per tunnel type (the full page of that type) and the shared settings.
   Everything is drawn as SVG, no outside files. Text is written in both languages right here. */

var NL = String.fromCharCode(10);
var BIN = '/usr/bin/vpnhub';
var FA = (document.documentElement.getAttribute('lang') || '').indexOf('fa') === 0;
var DIR = FA ? 'rtl' : 'ltr';
var NS = 'http://www.w3.org/2000/svg';
function T(fa, en) { return FA ? fa : en; }

function ex(args) {
	return fs.exec(BIN, args).then(function(r) { return (r && r.stdout) ? String(r.stdout).trim() : ''; }, function() { return ''; });
}
function S(tag, attrs, kids) {
	var n = document.createElementNS(NS, tag);
	for (var k in (attrs || {})) n.setAttribute(k, attrs[k]);
	(kids || []).forEach(function(c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
	return n;
}
function lines(out) {
	var o = {};
	(out || '').split(NL).forEach(function(l) {
		var i = l.indexOf('=');
		if (i < 1) return;
		(o[l.slice(0, i)] = o[l.slice(0, i)] || []).push(l.slice(i + 1));
	});
	return o;
}
function country(cc) {
	if (!cc) return '';
	try { return new Intl.DisplayNames([ FA ? 'fa' : 'en' ], { type: 'region' }).of(cc) || cc; } catch (e) { return cc; }
}
function flag(cc) {
	if (!/^[A-Z]{2}$/.test(cc || '')) return '';
	return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
}
function card(title, kids, extra) {
	return E('div', { 'class': 'cbi-section vh-card', 'style': extra || '' }, (title ? [ E('h3', {}, title) ] : []).concat(kids));
}
function tile(label, value) {
	var v = E('div', { 'class': 'vh-tile-v', 'dir': 'auto' }, value), extra = E('div', { 'class': 'vh-tile-x' });
	var box = E('div', { 'class': 'vh-tile' }, [ E('div', { 'style': 'min-width:0;flex:1' }, [ v, E('div', { 'class': 'vh-tile-l' }, label) ]), extra ]);
	box.set = function(x, tone) { v.textContent = x; v.style.color = tone || ''; };
	box.ring = function(pct, tone) {
		pct = Math.max(0, Math.min(100, pct || 0));
		var c = 2 * Math.PI * 15;
		extra.innerHTML = '';
		extra.appendChild(S('svg', { 'viewBox': '0 0 40 40', 'width': 44, 'height': 44 }, [
			S('circle', { 'cx': 20, 'cy': 20, 'r': 15, 'fill': 'none', 'stroke': 'currentColor', 'stroke-opacity': '.12', 'stroke-width': 4 }),
			S('circle', { 'cx': 20, 'cy': 20, 'r': 15, 'fill': 'none', 'stroke': tone || 'var(--hub-accent, currentColor)', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': (c * pct / 100) + ' ' + c, 'transform': 'rotate(-90 20 20)' })
		]));
	};
	return box;
}
function cssNode() {
	return E('style', {}, [
		'.vh-card{margin:0 0 16px!important}' +
		'.vh-wrap{margin:4px -6px 0}#view .vh-wrap>svg.vh-svg,#view div>svg.vh-svg{background-color:transparent!important}' +
		'.vh-svg{width:100%;height:auto;display:block;color:var(--hub-text,currentColor);direction:ltr;background:transparent!important;border:0!important;overflow:visible}' +
		'.vh-pulse{animation:vhpulse 2.6s ease-out infinite;transform-box:fill-box;transform-origin:center}' +
		'@keyframes vhpulse{0%{transform:scale(.6);opacity:.7}100%{transform:scale(2.6);opacity:0}}' +
		'.vh-flow{stroke-dasharray:5 9;animation:vhflow 1.6s linear infinite}' +
		'.vh-fast{stroke-dasharray:3 11;animation-duration:.7s}' +
		'.vh-blink{animation:vhblink 1.1s steps(2) infinite}@keyframes vhblink{50%{opacity:.25}}' +
		'@keyframes vhflow{to{stroke-dashoffset:-28}}' +
		'.vh-node{transition:opacity .2s}' +
		'.vh-dot{cursor:pointer}.vh-dot:hover{fill-opacity:1}' +
		'.vh-row-hi>td{background:var(--hub-accent-soft,rgba(128,128,128,.15))!important}' +
		'.vh-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px}' +
		'.vh-tile{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--hub-line,rgba(128,128,128,.25));border-radius:16px;background:var(--hub-surface-2,transparent);min-width:0}' +
		'.vh-tile-v{font-size:22px;font-weight:300;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:left}' +
		'[dir=rtl] .vh-tile-v{text-align:right}' +
		'.vh-tile-l{opacity:.7;font-size:12.5px;margin-top:1px}' +
		'.vh-tile-x{flex:none;line-height:0}' +
		'.vh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}' +
		'.vh-h{font-size:22px;font-weight:300;line-height:1.35}' +
		'.vh-sub{opacity:.72;font-size:13.5px;overflow-wrap:anywhere}' +
		'.vh-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--hub-line,rgba(128,128,128,.3));background:var(--hub-surface-2,transparent);font-weight:600;font-size:13px;white-space:nowrap;text-decoration:none!important;color:inherit!important}' +
		'.vh-chip i{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--hub-muted,#888)}' +
		'.vh-tabs{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;padding:4px;margin:0 0 14px;border:1px solid var(--hub-line,rgba(128,128,128,.3));border-radius:16px;background:var(--hub-surface,transparent);scrollbar-width:none;position:sticky;top:72px;z-index:5;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}' +
		'.vh-tabs::-webkit-scrollbar{display:none}' +
		'.vh-tab{flex:1 0 auto;padding:8px 16px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--hub-muted,inherit);font:inherit;font-weight:500;font-size:13.5px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:0;height:auto;box-shadow:none}' +
		'.vh-tab:hover{color:var(--hub-text,inherit)}' +
		'.vh-tab.on{background:var(--hub-accent,#888);color:var(--hub-accent-ink,#000);font-weight:600}' +
		'.vh-tab .live{width:7px;height:7px;border-radius:50%;background:var(--hub-ok,#4c4);box-shadow:0 0 8px var(--hub-ok,#4c4)}' +
		'.vh-tabbody>.cbi-map>h2,.vh-tabbody>.cbi-map>.cbi-map-descr{display:none}' +
		'@media (max-width:900px){.vh-tabs{top:64px}.vh-h{font-size:19px}}' +
		'@media (max-width:640px){.vh-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.vh-tile{padding:10px 12px}.vh-tile-v{font-size:18px}}' +
		'@media (prefers-reduced-motion: reduce){.vh-pulse,.vh-flow{animation:none}}'
	]);
}

/* ------------------------------------------------------------------ shared: where / devices / sys */
function parseWhere(out) {
	var o = lines(out), x = { rules: [] };
	if (o.home && o.home[0]) { var h = o.home[0].split('|'); x.home = { cc: h[0], colo: h[1], ip: h[2] }; }
	if (o.main) { var m = o.main[0].split('|'); x.main = { cc: m[0], colo: m[1], ip: m[2], up: m[3] === '1', type: m[4], label: m[5] || '', ping: m[6] || '' }; }
	(o.rule || []).forEach(function(l) { var r = l.split('|'); x.rules.push({ cc: r[0], colo: r[1], ip: r[2], n: r[3], label: r[4], sites: (r[5] || '').split(',') }); });
	return x;
}
function parseDevices(out) {
	var o = lines(out), r = (o.router ? o.router[0] : '||').split('|');
	var x = { router: { name: r[0] || 'Router', lan: r[1], wan: r[2] }, all: !o.all_devices || o.all_devices[0] !== '0', clients: (o.clients ? o.clients[0] : '').split(',').filter(function(c) { return c; }), tunnel: o.tunnel && o.tunnel[0] === '1', dev: [] };
	(o.dev || []).forEach(function(l) {
		var q = l.split('|');
		x.dev.push({ ip: q[0], mac: (q[1] || '').toUpperCase(), name: q[2] || '', state: q[3], conn: q[4], sig: q[5], left: q[6] });
	});
	x.use = {};
	(o.use || []).forEach(function(l) { var q = l.split('|'); if (q[0]) x.use[q[0].toUpperCase()] = { rx: +q[1] || 0, tx: +q[2] || 0 }; });
	x.dev.forEach(function(d) { var u = x.use[d.mac]; if (u) { d.rx = u.rx; d.tx = u.tx; } });
	x.blocked = {};
	(o.blk || []).forEach(function(l) { var q = l.split('|'); if (q[0]) x.blocked[q[0].toUpperCase()] = q[1] || ''; });
	/* blocked devices that are not around any more still get a row, so they can be let back in */
	Object.keys(x.blocked).forEach(function(m) {
		if (!x.dev.some(function(d) { return d.mac === m; })) x.dev.push({ ip: '', mac: m, name: x.blocked[m], state: 'off', conn: '', sig: '', left: '' });
	});
	var key = function(ip) { return ip.split('.').map(function(n) { return ('00' + n).slice(-3); }).join(''); };
	var rank = { on: 0, idle: 1, off: 2 };
	x.dev.sort(function(a, b) { return (rank[a.state] - rank[b.state]) || key(a.ip).localeCompare(key(b.ip)); });
	return x;
}
function bytes(n) {
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (n >= 1000 && i < 4) { n /= 1000; i++; }
	return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}
function human(bps) {
	var u = [ 'b/s', 'Kb/s', 'Mb/s', 'Gb/s' ], i = 0;
	while (bps >= 1000 && i < 3) { bps /= 1000; i++; }
	return (bps >= 100 || i === 0 ? Math.round(bps) : bps.toFixed(1)) + ' ' + u[i];
}
function uptime(s) {
	s = +s || 0;
	var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
	return d ? d + 'd ' + h + 'h' : (h ? h + 'h ' + m + 'm' : m + 'm');
}
function leftTime(sec) {
	sec = +sec;
	if (!(sec > 0)) return '—';
	var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
	return h ? h + T(' ساعت', ' h') : m + T(' دقیقه', ' m');
}
function label(x, y, text, size, op, weight, anchor) {
	/* Persian text is laid out right to left, and then "start" and "end" swap sides: swap them back so the label keeps
	   exactly the place it was given (left edge at x for "start", right edge at x for "end") */
	var rtl = /[\u0600-\u06FF]/.test(String(text)), an = anchor || 'middle';
	if (rtl && an !== 'middle') an = an === 'start' ? 'end' : 'start';
	return S('text', { 'x': x, 'y': y, 'direction': rtl ? 'rtl' : 'ltr', 'unicode-bidi': 'isolate', 'text-anchor': an, 'font-size': size, 'font-weight': weight || 400, 'fill': 'currentColor', 'fill-opacity': op, 'paint-order': 'stroke', 'stroke': 'var(--hub-bg, #000)', 'stroke-width': 4, 'stroke-linejoin': 'round' }, [ text ]);
}

/* ================================================================== home */
var AMERICAS = ' US CA MX BR AR CL CO PE VE EC UY PY BO CR PA GT DO PR CU JM TT HN NI SV BS BZ GY SR HT ';
var ICON = {
	phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
	computer: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 20h8M12 16v4',
	tv: 'M3 6h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 21h10',
	wifi: 'M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M12 19h.01',
	wired: 'M9 3h6v5H9zM12 8v5M5 13h14v3H5zM7 16v4M12 16v4M17 16v4'
};
function kindOf(d) {
	var n = (d.name || '').toLowerCase();
	if (/iphone|android|galaxy|phone|pixel|redmi|xiaomi|huawei|oppo|vivo|poco|honor|ipad|tab/.test(n)) return 'phone';
	if (/tv|chromecast|shield|fire|roku|bravia|webos/.test(n)) return 'tv';
	if (/macbook|laptop|desktop|pc|office|win|imac|thinkpad|dell|asus|lenovo|book/.test(n)) return 'computer';
	return d.conn === 'wifi' ? 'wifi' : 'wired';
}
function icon(name, x, y, size) {
	return S('g', { 'transform': 'translate(' + (x - size / 2) + ' ' + (y - size / 2) + ') scale(' + (size / 24) + ')', 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [ S('path', { 'd': ICON[name] || ICON.wired }) ]);
}
/* the router itself: a puck with a light band for the Google WiFi, a box with antennas for everything else */
function routerArt(cx, cy, board, led) {
	var g = S('g', {});
	g.appendChild(S('ellipse', { 'cx': cx, 'cy': cy + 46, 'rx': 62, 'ry': 9, 'fill': '#000', 'fill-opacity': '.45' }));
	if (/google,wifi/.test(board || '')) {
		g.appendChild(S('path', { 'd': 'M' + (cx - 54) + ' ' + (cy - 26) + ' v52 a54 12 0 0 0 108 0 v-52 z', 'fill': 'url(#vhBody)' }));
		g.appendChild(S('ellipse', { 'cx': cx, 'cy': cy - 26, 'rx': 54, 'ry': 12, 'fill': 'url(#vhTop)' }));
		g.appendChild(S('path', { 'd': 'M' + (cx - 54) + ' ' + (cy - 2) + ' a54 12 0 0 0 108 0', 'fill': 'none', 'stroke': led, 'stroke-width': 5, 'stroke-linecap': 'round', 'filter': 'url(#vhGlow)' }));
		g.appendChild(S('path', { 'd': 'M' + (cx - 54) + ' ' + (cy - 2) + ' a54 12 0 0 0 108 0', 'fill': 'none', 'stroke': led, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
	} else {
		[ -34, 34 ].forEach(function(dx) { g.appendChild(S('rect', { 'x': cx + dx - 3, 'y': cy - 58, 'width': 6, 'height': 50, 'rx': 3, 'fill': 'url(#vhBody)' })); });
		g.appendChild(S('rect', { 'x': cx - 62, 'y': cy - 12, 'width': 124, 'height': 46, 'rx': 12, 'fill': 'url(#vhBody)' }));
		g.appendChild(S('rect', { 'x': cx - 62, 'y': cy - 12, 'width': 124, 'height': 10, 'rx': 5, 'fill': 'url(#vhTop)' }));
		[ -36, -18, 0 ].forEach(function(dx) { g.appendChild(S('circle', { 'cx': cx + dx, 'cy': cy + 16, 'r': 3.2, 'fill': led })); });
	}
	return g;
}
/* where the traffic leaves: a server tower in the same brushed-silver material as the router when a tunnel is used,
   a silver globe for the plain line */
function rackArt(cx, cy, led, on) {
	/* three thin slabs, cut from the same silver as the router: light, with one small lamp each */
	var g = S('g', {});
	g.appendChild(S('ellipse', { 'cx': cx, 'cy': cy + 35, 'rx': 34, 'ry': 5, 'fill': '#000', 'fill-opacity': '.4' }));
	[ -19, 0, 19 ].forEach(function(dy, n) {
		var y = cy + dy;
		if (on) g.appendChild(S('rect', { 'x': cx - 26, 'y': y - 5, 'width': 52, 'height': 10, 'rx': 5, 'fill': led, 'fill-opacity': '.5', 'filter': 'url(#vhGlow)' }));
		g.appendChild(S('rect', { 'x': cx - 30, 'y': y - 7.5, 'width': 60, 'height': 15, 'rx': 6, 'fill': 'url(#vhBody)' }));
		g.appendChild(S('line', { 'x1': cx - 24, 'y1': y - 6.3, 'x2': cx + 24, 'y2': y - 6.3, 'stroke': '#fff', 'stroke-opacity': '.8', 'stroke-width': 1, 'stroke-linecap': 'round' }));
		g.appendChild(S('circle', { 'cx': cx - 21, 'cy': y + .5, 'r': 2.3, 'fill': on ? led : '#8b8b94', 'class': on && n === 0 ? 'vh-blink' : '' }));
		g.appendChild(S('line', { 'x1': cx - 6, 'y1': y + .5, 'x2': cx + 21, 'y2': y + .5, 'stroke': '#3d3d46', 'stroke-opacity': '.55', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
	});
	return g;
}
function globeArt(cx, cy) {
	var g = S('g', {});
	g.appendChild(S('ellipse', { 'cx': cx, 'cy': cy + 35, 'rx': 26, 'ry': 4.5, 'fill': '#000', 'fill-opacity': '.4' }));
	g.appendChild(S('circle', { 'cx': cx, 'cy': cy, 'r': 28, 'fill': 'url(#vhBody)' }));
	var l = S('g', { 'fill': 'none', 'stroke': '#3d3d46', 'stroke-opacity': '.75', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
	l.appendChild(S('ellipse', { 'cx': cx, 'cy': cy, 'rx': 12, 'ry': 28 }));
	l.appendChild(S('path', { 'd': 'M' + (cx - 28) + ' ' + cy + ' h56 M' + (cx - 24) + ' ' + (cy - 14) + ' h48 M' + (cx - 24) + ' ' + (cy + 14) + ' h48' }));
	g.appendChild(l);
	g.appendChild(S('ellipse', { 'cx': cx - 9, 'cy': cy - 12, 'rx': 10, 'ry': 6, 'fill': '#fff', 'fill-opacity': '.35', 'transform': 'rotate(-28 ' + (cx - 9) + ' ' + (cy - 12) + ')' }));
	return g;
}
function defs() {
	return S('defs', {}, [
		S('linearGradient', { 'id': 'vhBody', 'x1': 0, 'y1': 0, 'x2': 1, 'y2': 1 }, [ S('stop', { 'offset': 0, 'stop-color': '#fafafa' }), S('stop', { 'offset': .55, 'stop-color': '#c9c9cf' }), S('stop', { 'offset': 1, 'stop-color': '#7d7d86' }) ]),
		S('linearGradient', { 'id': 'vhTop', 'x1': 0, 'y1': 0, 'x2': 0, 'y2': 1 }, [ S('stop', { 'offset': 0, 'stop-color': '#ffffff' }), S('stop', { 'offset': 1, 'stop-color': '#dcdce0' }) ]),
		S('filter', { 'id': 'vhGlow', 'x': '-50%', 'y': '-300%', 'width': '200%', 'height': '700%' }, [ S('feGaussianBlur', { 'stdDeviation': 3.2 }) ])
	]);
}

function homeView() {
	return view.extend({
		load: function() {
			var me = window.fetch ? fetch(L.env.cgi_base + '/hub-me', { cache: 'no-store', credentials: 'same-origin' }).then(function(r) { return r.text(); }).catch(function() { return ''; }) : '';
			return Promise.all([ ex([ 'devices' ]), ex([ 'where' ]), ex([ 'sys' ]), me ]);
		},
		render: function(res) {
			/* on a phone the picture is drawn narrower and taller, so the same text ends up almost twice as large */
			var SMALL = (window.innerWidth || 1000) < 700;
			var W = SMALL ? 600 : 1000, H = SMALL ? 680 : 630, CX = W / 2, CY = SMALL ? 270 : 262;
			var svg = S('svg', { 'class': 'vh-svg', 'viewBox': '0 0 ' + W + ' ' + H, 'role': 'img' });
			var tbody = E('tbody', {});
			var head = E('div', { 'class': 'vh-h' }, ''), sub = E('div', { 'class': 'vh-sub' }, '');
			var chipDot = E('i', {}), chipText = E('span', {}, '');
			var chip = E('a', { 'class': 'vh-chip', 'href': L.url('admin/vpnhub') }, [ chipDot, chipText ]);
			var tOn = tile(T('دستگاه روشن', 'Devices online'), '0'), tDown = tile(T('دانلود همین لحظه', 'Download now'), '—'), tUp = tile(T('آپلود همین لحظه', 'Upload now'), '—');
			var tMem = tile(T('حافظه مصرف‌شده', 'Memory used'), '—'), tLoad = tile(T('بار پردازنده', 'Processor load'), '—'), tTime = tile(T('روشن از', 'Up for'), '—');
			var rows = {}, dev = parseDevices(res[0]), where = parseWhere(res[1]), sys = lines(res[2]), lastWan = null, me = String(res[3] || '').trim();

			/* ask first, then run a vpnhub command and repaint the list */
			function act(title, text, label, danger, args) {
				ui.showModal(title, [
					E('p', {}, text),
					E('div', { 'class': 'right', 'style': 'display:flex;gap:8px;justify-content:flex-end' }, [
						E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, T('انصراف', 'Cancel')),
						E('button', { 'class': 'cbi-button ' + (danger ? 'cbi-button-negative important' : 'cbi-button-action important'), 'click': function() {
							ui.hideModal();
							return ex(args).then(function() { return ex([ 'devices' ]); }).then(function(o) { if (o) { dev = rates(parseDevices(o)); paint(); } });
						} }, label)
					])
				]);
			}
			function actions(d) {
				var nm = d.name || d.mac;
				if (d.ip && d.ip === me) return E('span', { 'class': 'vh-me' }, T('همین دستگاه', 'This device'));
				if (dev.blocked[d.mac] !== undefined) return E('div', { 'class': 'vh-acts', 'style': 'display:flex;gap:6px;align-items:center' }, [
					E('span', { 'class': 'vh-blk' }, T('مسدود', 'Blocked')),
					page.iconButton('unban', T('آزاد کردن ', 'Let back in ') + nm, '', function() {
						act(T('آزاد کردن دستگاه', 'Let the device back in'), T('«', '"') + nm + T('» دوباره به اینترنت و روتر دسترسی پیدا می‌کند.', '" gets internet and the router back.'), T('آزاد کن', 'Let it in'), false, [ 'unblock', d.mac ]);
					})
				]);
				var b = [];
				if (d.conn === 'wifi' && d.state !== 'off') b.push(page.iconButton('kick', T('قطع از وای‌فای ', 'Drop from Wi-Fi: ') + nm, '', function() {
					act(T('قطع از وای‌فای', 'Drop from Wi-Fi'), T('«', '"') + nm + T('» از وای‌فای بیرون انداخته می‌شود. اگر رمز وای‌فای را داشته باشد، بعد از یک دقیقه می‌تواند دوباره وصل شود. برای جلوگیری کامل، «مسدود کردن» را بزنید.', '" is dropped from the Wi-Fi. If it knows the password it can join again after a minute; to keep it out, use "Block".'), T('قطع کن', 'Drop it'), false, [ 'kick', d.mac ]);
				}));
				b.push(page.iconButton('ban', T('مسدود کردن ', 'Block ') + nm, ' cbi-button-negative', function() {
					act(T('مسدود کردن دستگاه', 'Block the device'), T('«', '"') + nm + T('» دیگر نه به اینترنت دسترسی دارد و نه به روتر، تا وقتی دوباره آزادش کنید. با خاموش و روشن شدن روتر هم مسدود می‌ماند.', '" loses internet and the router until you let it back in, also after the router restarts.'), T('مسدود کن', 'Block'), true, [ 'block', d.mac, d.name || '' ]);
				}));
				return E('div', { 'class': 'vh-acts', 'style': 'display:flex;gap:6px;justify-content:flex-end' }, b);
			}

			var seen = {};
			function rates(x) {
				var now = Date.now();
				x.dev.forEach(function(d) {
					if (d.rx == null) return;
					var p = seen[d.mac], tot = d.rx + d.tx;
					if (!p) { seen[d.mac] = { tot: tot, t: now, rate: 0 }; return; }
					if (tot !== p.tot) { p.rate = tot > p.tot ? (tot - p.tot) * 8 / Math.max(1, (now - p.t) / 1000) : 0; p.tot = tot; p.t = now; }
					else if (now - p.t > 75000) p.rate = 0;
					d.rate = p.rate;
				});
				return x;
			}
			rates(dev);

			function paint() {
				svg.innerHTML = ''; tbody.innerHTML = ''; rows = {};
				svg.appendChild(defs());
				var live = dev.dev.filter(function(d) { return d.state !== 'off'; });
				svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (live.length <= 3 ? (SMALL ? 560 : 540) : H));
				var up = where.main && where.main.up, trying = where.main && !where.main.up;
				/* the same colours as the light on the router itself: white = direct, blue = tunnel, red = tunnel leaving in the Americas,
				   yellow = wanted but not connected */
				var led = up ? (AMERICAS.indexOf(' ' + where.main.cc + ' ') >= 0 ? '#ff4d4d' : '#4d7dff') : (trying ? '#ffb020' : '#ffffff');

				(SMALL ? [ [ 150, 150 ], [ 235, 240 ] ] : [ [ 250, 138 ], [ 400, 222 ] ]).forEach(function(r) {
					svg.appendChild(S('ellipse', { 'cx': CX, 'cy': CY, 'rx': r[0], 'ry': r[1], 'fill': 'none', 'stroke': 'currentColor', 'stroke-opacity': '.07', 'stroke-dasharray': '2 7' }));
				});
				var lineLayer = S('g', {}), nodeLayer = S('g', {});
				svg.appendChild(lineLayer); svg.appendChild(nodeLayer);

				/* the way out: router -> where the traffic leaves */
				var cc = up ? where.main.cc : (where.home ? where.home.cc : ''), outY = 54;
				var pipe = up ? led : 'currentColor';
				lineLayer.appendChild(S('line', { 'x1': CX, 'y1': CY - 40, 'x2': CX, 'y2': outY + 30, 'stroke': pipe, 'stroke-opacity': up ? '.18' : '.08', 'stroke-width': 9, 'stroke-linecap': 'round' }));
				lineLayer.appendChild(S('line', { 'x1': CX, 'y1': CY - 40, 'x2': CX, 'y2': outY + 30, 'stroke': pipe, 'stroke-opacity': up ? '1' : '.35', 'stroke-width': up ? 1.8 : 1.2, 'stroke-linecap': 'round', 'class': up ? 'vh-flow vh-fast' : '' }));
				var t1 = (cc ? country(cc) + '  ' + flag(cc) : T('اینترنت', 'Internet'));
				var t2 = up ? where.main.label.replace(/[^\x20-\x7E]/g, '').trim() + (where.main.ping ? '  ·  ' + Math.round(where.main.ping) + ' ms' : '') : (trying ? T('در حال وصل شدن', 'connecting') : T('خط مستقیم، بدون تونل', 'direct line, no VPN'));
				nodeLayer.appendChild(up || trying ? rackArt(CX, outY, led, up) : globeArt(CX, outY));
				/* mirrored for Persian: the words sit on the reading side of the globe / server, right-aligned against it */
				var sx = FA ? CX - 48 : CX + 48, sa = FA ? 'end' : 'start';
				nodeLayer.appendChild(label(sx, outY - 3, t1, 17, 1, 500, sa));
				nodeLayer.appendChild(label(sx, outY + 16, t2.slice(0, 44), 12.5, .7, 400, sa));

				/* devices on the lower three quarters of the ring, the top is kept for the way out */
				var n = live.length, two = n > 8, a0 = -22 * Math.PI / 180, span = 224 * Math.PI / 180;
				live.forEach(function(d, i) {
					var ring = two ? i % 2 : 0, rx = two ? (ring ? 410 : 262) : (n <= 3 ? 300 : 390), ry = two ? (ring ? 226 : 146) : (n <= 3 ? 170 : 216);
					if (SMALL) { rx = two ? (ring ? 232 : 150) : (n <= 3 ? 205 : 228); ry = two ? (ring ? 262 : 170) : (n <= 3 ? 170 : 250); }
					var a = a0 + (i + .5) * span / n, px = CX + rx * Math.cos(a), py = CY + ry * Math.sin(a), on = d.state === 'on';
					lineLayer.appendChild(S('line', { 'x1': CX, 'y1': CY, 'x2': px, 'y2': py, 'stroke': 'currentColor', 'stroke-opacity': on ? '.45' : '.16', 'stroke-width': 1.2, 'class': (on && d.conn === 'wifi') ? 'vh-flow' : '' }));
					var g = S('g', { 'class': 'vh-node', 'opacity': on ? 1 : .55 });
					g.appendChild(S('circle', { 'cx': px, 'cy': py, 'r': 27, 'fill': 'var(--hub-bg, #111)', 'stroke': 'currentColor', 'stroke-opacity': '.35', 'stroke-width': 1.2 }));
					g.appendChild(S('circle', { 'cx': px, 'cy': py, 'r': 27, 'fill': 'currentColor', 'fill-opacity': '.06' }));
					g.appendChild(icon(kindOf(d), px, py, 24));
					g.appendChild(S('circle', { 'cx': px + 19, 'cy': py - 19, 'r': 5, 'fill': on ? 'var(--hub-ok, #4c4)' : 'var(--hub-muted, #888)', 'stroke': 'var(--hub-bg, #000)', 'stroke-width': 2 }));
					g.appendChild(label(px, py + 47, (d.name || d.mac).slice(0, 22), 14, 1, 600));
					g.appendChild(label(px, py + 63, d.ip + (d.conn === 'wifi' && d.sig ? '  ·  ' + d.sig + ' dBm' : ''), 12, .65));
					if (d.rx != null) {
						var use = label(px, py + 80, '↓ ' + bytes(d.rx) + '   ↑ ' + bytes(d.tx), 12, .8, 500);
						use.appendChild(S('title', {}, [ T('مصرف این دوره (ماه)', 'Used this period (month)') ]));
						g.appendChild(use);
						if (d.rate > 20000) g.appendChild(label(px, py + 96, T('الان ', 'now ') + human(d.rate), 11.5, .6));
					}
					g.addEventListener('mouseenter', function() { if (rows[d.mac]) rows[d.mac].classList.add('vh-row-hi'); });
					g.addEventListener('mouseleave', function() { if (rows[d.mac]) rows[d.mac].classList.remove('vh-row-hi'); });
					nodeLayer.appendChild(g);
				});

				nodeLayer.appendChild(S('circle', { 'cx': CX, 'cy': CY + 6, 'r': 44, 'fill': led, 'fill-opacity': '.14', 'class': 'vh-pulse' }));
				nodeLayer.appendChild(routerArt(CX, CY, (sys.board || [ '' ])[0], led));
				nodeLayer.appendChild(label(CX, CY + 78, (sys.model || [ dev.router.name ])[0].replace(/\s*\(.*\)\s*$/, ''), 15, 1, 600));
				nodeLayer.appendChild(label(CX, CY + 95, dev.router.lan || '', 12, .65));
				if (!n) nodeLayer.appendChild(label(CX, CY + 160, T('الان دستگاهی وصل نیست', 'No device is connected right now'), 15, .7));

				head.textContent = up ? T('اینترنت از تونل ', 'Connected through a VPN in ') + country(where.main.cc) + T(' خارج می‌شود', '') : (trying ? T('تونل در حال وصل شدن است', 'Connecting to the VPN…') : T('اینترنت مستقیم است، بدون تونل', 'Direct connection, no VPN'));
				sub.textContent = n + T(' دستگاه به روتر وصل است', n === 1 ? ' device is connected to the router' : ' devices are connected to the router') + (where.rules.length ? ' · ' + where.rules.length + T(' قانون سایت فعال', ' site rules active') : '');
				chipDot.style.background = up ? 'var(--hub-ok, #4c4)' : (trying ? 'var(--hub-warn, #cc4)' : 'var(--hub-muted, #888)');
				chipDot.style.boxShadow = up ? '0 0 10px var(--hub-ok, #4c4)' : 'none';
				chipText.textContent = up ? T('تونل وصل است', 'VPN connected') + ' · ' + where.main.type.toUpperCase() : (trying ? T('تونل در حال اتصال', 'VPN connecting') : T('تونل خاموش است', 'VPN is off'));

				dev.dev.forEach(function(d) {
					var on = d.state === 'on', idle = d.state === 'idle', via = dev.tunnel && (dev.all || dev.clients.indexOf(d.ip) >= 0);
					var tr = E('tr', { 'class': 'tr', 'style': d.state === 'off' ? 'opacity:.5' : '' }, [
						E('td', { 'class': 'td', 'data-title': T('نام', 'Name') }, [ E('span', { 'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-inline-end:8px;background:' + (on ? 'var(--hub-ok, #4c4)' : (idle ? 'var(--hub-warn, #cc4)' : 'var(--hub-muted, #888)')) }), E('strong', {}, d.name || T('بی‌نام', 'unnamed')) ]),
						E('td', { 'class': 'td', 'data-title': T('نشانی', 'Address') }, E('span', { 'dir': 'ltr' }, d.ip)),
						E('td', { 'class': 'td', 'style': 'font-size:90%', 'data-title': 'MAC' }, E('span', { 'dir': 'ltr' }, d.mac)),
						E('td', { 'class': 'td', 'data-title': T('اتصال', 'Connection') }, d.conn === 'wifi' ? T('وای‌فای', 'Wi-Fi') + (d.sig ? ' (' + d.sig + ' dBm)' : '') : (d.conn === 'wired' ? T('کابل', 'Wired') : '—')),
						E('td', { 'class': 'td', 'data-title': T('وضعیت', 'State') }, on ? T('روشن', 'online') : (idle ? T('بی‌کار', 'idle') : T('خاموش', 'offline'))),
						E('td', { 'class': 'td', 'data-title': T('مسیر اینترنت', 'Internet path') }, d.state === 'off' ? '—' : (via ? T('از تونل', 'VPN') : T('مستقیم', 'direct'))),
						E('td', { 'class': 'td', 'data-title': T('تخصیص نشانی', 'Lease left') }, leftTime(d.left)),
						E('td', { 'class': 'td vh-actcell' }, actions(d))
					]);
					rows[d.mac] = tr; tbody.appendChild(tr);
				});
				if (!dev.dev.length) tbody.appendChild(E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': '8' }, E('em', {}, T('هنوز دستگاهی دیده نشده است.', 'No device has been seen yet.'))) ]));
				tOn.set(String(dev.dev.filter(function(d) { return d.state === 'on'; }).length));
			}
			function paintSys() {
				var mem = (sys.mem ? sys.mem[0] : '0|0').split('|'), used = mem[0] > 0 ? Math.round((1 - mem[1] / mem[0]) * 100) : 0;
				tMem.set(used + '%'); tMem.ring(used, used > 85 ? 'var(--hub-bad, #c44)' : null);
				var cpus = +(sys.cpus || [ 1 ])[0] || 1, ld = Math.round(+(sys.load || [ 0 ])[0] / cpus * 100);
				tLoad.set(ld + '%'); tLoad.ring(ld, ld > 90 ? 'var(--hub-bad, #c44)' : null);
				tTime.set(uptime((sys.uptime || [ 0 ])[0]));
				var w = (sys.wan ? sys.wan[0] : '').split('|');
				if (w.length >= 4 && lastWan && +w[3] > +lastWan[3] && w[0] === lastWan[0]) {
					var dt = +w[3] - +lastWan[3];
					tDown.set(human(Math.max(0, (+w[1] - +lastWan[1]) * 8 / dt)));
					tUp.set(human(Math.max(0, (+w[2] - +lastWan[2]) * 8 / dt)));
				}
				if (w.length >= 4) lastWan = w;
			}
			paint(); paintSys();
			poll.add(function() { return ex([ 'sys' ]).then(function(o) { if (o) { sys = lines(o); paintSys(); } }); }, 3);
			poll.add(function() { return ex([ 'devices' ]).then(function(o) { if (o) { dev = rates(parseDevices(o)); paint(); } }); }, 7);
			poll.add(function() { return ex([ 'where' ]).then(function(o) { if (o) { where = parseWhere(o); paint(); } }); }, 20);

			return E('div', { 'class': 'cbi-map', 'dir': DIR, 'style': 'text-align:start' }, [
				cssNode(),
				card(null, [
					E('div', { 'class': 'vh-head' }, [ E('div', { 'style': 'min-width:0' }, [ head, sub ]), chip ]),
					E('div', { 'class': 'vh-wrap' }, [ svg ]),
					E('div', { 'class': 'vh-tiles' }, [ tOn, tDown, tUp, tMem, tLoad, tTime ])
				]),
				card(T('دستگاه‌ها', 'Devices'), [
					E('table', { 'class': 'table vh-stack' }, [
						E('thead', {}, [ E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th' }, T('نام', 'Name')), E('th', { 'class': 'th' }, T('نشانی', 'Address')), E('th', { 'class': 'th' }, 'MAC'),
							E('th', { 'class': 'th' }, T('اتصال', 'Connection')), E('th', { 'class': 'th' }, T('وضعیت', 'State')),
							E('th', { 'class': 'th' }, T('مسیر اینترنت', 'Internet path')), E('th', { 'class': 'th' }, T('تخصیص نشانی', 'Lease left')),
							E('th', { 'class': 'th' }, '')
						]) ]),
						tbody
					])
				])
			]);
		},
		handleSave: null, handleSaveApply: null, handleReset: null
	});
}

/* ================================================================== hub: map + one tab per tunnel type */
var MW = 1000, MH = 0, MAPPAD = 8;
/* the map keeps its shape on a phone, so marks and text are drawn larger there */
var K = 1;
function cell() { return MW / (360 / world.step); }
function proj(lon, lat) { return [ (lon + 180) / 360 * MW, MAPPAD + (world.top + world.step / 2 - lat) / world.step * cell() ]; }
function drawWorld() {
	var c = cell(), g = S('g', { 'fill': 'currentColor', 'fill-opacity': '.17' });
	world.rows.forEach(function(row, r) {
		for (var i = 0; i < row.length; i++) {
			var v = parseInt(row.charAt(i), 16);
			for (var b = 0; b < 4; b++) if (v & (8 >> b)) g.appendChild(S('circle', { 'cx': ((i * 4 + b) + .5) * c, 'cy': MAPPAD + (r + .5) * c, 'r': c * .26 }));
		}
	});
	MH = MAPPAD * 2 + world.rows.length * c;
	return g;
}
function arcPath(a, b) {
	var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy), lift = Math.min(170, d * .32 + 18);
	return 'M' + a[0] + ' ' + a[1] + ' Q' + ((a[0] + b[0]) / 2) + ' ' + ((a[1] + b[1]) / 2 - lift) + ' ' + b[0] + ' ' + b[1];
}
var CITY_KEYS = null, NAME_KEYS = null;
/* where a server is, read from the words of its name: a flag, a city, or a country */
function locate(text) {
	var t = (text || '').toLowerCase(), cc = '';
	var m = /\uD83C([\uDDE6-\uDDFF])\uD83C([\uDDE6-\uDDFF])/.exec(text || '');
	if (m) cc = String.fromCharCode(m[1].charCodeAt(0) - 0xDDE6 + 65, m[2].charCodeAt(0) - 0xDDE6 + 65);
	if (!CITY_KEYS) {
		CITY_KEYS = Object.keys(world.city).sort(function(a, b) { return b.length - a.length; });
		NAME_KEYS = Object.keys(world.names).sort(function(a, b) { return b.length - a.length; });
	}
	for (var i = 0; i < CITY_KEYS.length; i++) {
		var k = CITY_KEYS[i], at = t.indexOf(k);
		if (at >= 0 && !/[a-z]/.test(t.charAt(at - 1) || ' ') && !/[a-z]/.test(t.charAt(at + k.length) || ' ')) {
			var c = world.city[k];
			if (!cc || cc === c[2]) return { lon: c[0], lat: c[1], cc: c[2] };
		}
	}
	if (!cc) for (var j = 0; j < NAME_KEYS.length; j++) if (t.indexOf(NAME_KEYS[j]) >= 0) { cc = world.names[NAME_KEYS[j]]; break; }
	if (cc && world.cc[cc]) return { lon: world.cc[cc][0], lat: world.cc[cc][1], cc: cc };
	return null;
}
function ascii(s) { return (s || '').replace(/[^\x20-\x7E]/g, '').trim(); }

function hubView() {
	return view.extend({
		load: function() { return ex([ 'where' ]); },
		render: function(res) {
			var svg = S('svg', { 'class': 'vh-svg', 'viewBox': '0 0 ' + MW + ' 400', 'role': 'img' });
			svg.appendChild(drawWorld());
			svg.setAttribute('viewBox', '0 0 ' + MW + ' ' + MH);
			var dotLayer = S('g', {}), layer = S('g', {});
			svg.appendChild(dotLayer); svg.appendChild(layer);

			var head = E('div', { 'class': 'vh-h' }, ''), sub = E('div', { 'class': 'vh-sub' }, '');
			var tExit = tile(T('خروجی فعلی', 'Current exit'), '—'), tPing = tile(T('پینگ تا سرور', 'Ping to server'), '—'), tSrv = tile(T('سرور روی نقشه', 'Servers on the map'), '—'), tRule = tile(T('قانون سایت', 'Site rules'), '0');
			var where = parseWhere(res), profs = [], curType = '', body = E('div', { 'class': 'vh-tabbody' }, ''), tabs = {};

			function marker(pt, text, subText, bright, side) {
				var col = bright ? 'var(--hub-ok, #5d8)' : 'currentColor';
				layer.appendChild(S('circle', { 'cx': pt[0], 'cy': pt[1], 'r': 7 * K, 'fill': col, 'fill-opacity': '.4', 'class': 'vh-pulse' }));
				layer.appendChild(S('circle', { 'cx': pt[0], 'cy': pt[1], 'r': (bright ? 5.5 : 4) * K, 'fill': col, 'stroke': 'var(--hub-bg, #000)', 'stroke-width': 1.5 }));
				var leftSide = side ? side === 'l' : pt[0] > MW * .78, x = pt[0] + (leftSide ? -12 : 12) * K, an = leftSide ? 'end' : 'start';
				layer.appendChild(label(x, pt[1] - 3, text, 15 * K, 1, 600, an));
				if (subText) layer.appendChild(label(x, pt[1] + 14 * K, subText, 12 * K, .72, 400, an));
			}
			function paintMap() {
				layer.innerHTML = ''; dotLayer.innerHTML = '';
				/* text on the map should come out at about 11 px whatever the width of the page */
				var wpx = svg.getBoundingClientRect().width || Math.min(960, (window.innerWidth || 1000) - 60);
				K = Math.max(1, Math.min(2, 11 / (15 * wpx / MW)));
				var home = where.home && world.cc[where.home.cc] ? proj(world.cc[where.home.cc][0], world.cc[where.home.cc][1]) : null;
				/* every server of the open tab, as a dim dot */
				var seen = {}, placed = 0;
				profs.forEach(function(p) {
					var l = locate(p.label + ' ' + p.host);
					if (!l) return;
					placed++;
					var key = l.lon + ',' + l.lat;
					if (seen[key]) { seen[key].n++; seen[key].t.textContent = seen[key].name + ' (+' + (seen[key].n - 1) + ')'; return; }
					var pt = proj(l.lon, l.lat), ttl = S('title', {}, [ p.label ]);
					var d = S('circle', { 'cx': pt[0], 'cy': pt[1], 'r': 3.4 * Math.sqrt(K), 'fill': 'currentColor', 'fill-opacity': '.55', 'stroke': 'var(--hub-bg, #000)', 'stroke-width': .8, 'class': 'vh-dot' }, [ ttl ]);
					d.addEventListener('click', function() {
						var inp = body.querySelector('input[type="text"][placeholder]');
						if (!inp) return;
						inp.value = ascii(p.label).split(/\s+-\s+|\s{2,}/)[0].trim();
						inp.dispatchEvent(new Event('input'));
						inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
					});
					dotLayer.appendChild(d);
					seen[key] = { n: 1, t: ttl, name: p.label };
				});
				tSrv.set(curType && curType !== 'settings' ? placed + ' / ' + profs.length : '—');

				var draw = function(pt, bright) {
					if (!home || !pt) return;
					layer.appendChild(S('path', { 'd': arcPath(home, pt), 'fill': 'none', 'stroke': bright ? 'var(--hub-ok, #5d8)' : 'currentColor', 'stroke-opacity': bright ? '.95' : '.45', 'stroke-width': (bright ? 2 : 1.3) * K, 'stroke-linecap': 'round', 'class': 'vh-flow' }));
				};
				where.rules.forEach(function(r) {
					var l = locate(r.label);
					if (!l || l.cc !== r.cc) l = world.cc[r.cc] ? { lon: world.cc[r.cc][0], lat: world.cc[r.cc][1] } : l;
					if (!l || !home) return;
					var pt = proj(l.lon, l.lat);
					draw(pt, false); marker(pt, flag(r.cc) + ' ' + country(r.cc), T('قانون ', 'rule ') + r.n + ' · ' + r.sites[0], false, pt[0] < home[0] ? 'l' : 'r');
				});
				var homeSide = null, up = where.main && where.main.up;
				if (up && where.main.cc) {
					var l = locate(where.main.label);
					if (!l || l.cc !== where.main.cc) l = world.cc[where.main.cc] ? { lon: world.cc[where.main.cc][0], lat: world.cc[where.main.cc][1] } : l;
					if (l && home) {
						var pt = proj(l.lon, l.lat), side = pt[0] < home[0] ? 'l' : 'r';
						draw(pt, true);
						marker(pt, flag(where.main.cc) + ' ' + country(where.main.cc), ascii(where.main.label).slice(0, 34) + (where.main.ping ? '  ·  ' + Math.round(where.main.ping) + ' ms' : ''), true, side);
						homeSide = side === 'l' ? 'r' : 'l';
					}
					head.textContent = T('اینترنت از تونل ', 'Connected through a VPN in ') + country(where.main.cc) + T(' خارج می‌شود', '');
					sub.textContent = where.main.type.toUpperCase() + ' — ' + where.main.label + ' — ' + where.main.ip;
					tExit.set(country(where.main.cc), 'var(--hub-ok, inherit)');
					tPing.set(where.main.ping ? Math.round(where.main.ping) + T(' میلی‌ثانیه', ' ms') : '—');
				} else if (where.main) {
					head.textContent = T('تونل در حال تلاش برای وصل شدن است', 'Connecting to the VPN…');
					sub.textContent = T('فعلاً همه چیز از خط مستقیم می‌رود. سرور: ', 'Until then, everything goes out directly. Server: ') + where.main.label;
					tExit.set(where.home ? country(where.home.cc) : '—'); tPing.set('—');
				} else {
					head.textContent = T('تونل خاموش است', 'VPN is off');
					sub.textContent = T('یک سربرگ را باز کنید و دایره کنار یک سرور را بزنید تا وصل شود. نقطه‌های روی نقشه سرورهای همان سربرگ‌اند.', 'Open a tab and click the circle next to a server to connect. The dots on the map are the servers of that tab.');
					tExit.set(where.home ? country(where.home.cc) : '—'); tPing.set('—');
				}
				if (home) marker(home, T('خانه', 'Home'), where.home ? country(where.home.cc) : '', false, homeSide);
				tRule.set(String(where.rules.length));
				Object.keys(tabs).forEach(function(k) { tabs[k].live.style.display = (where.main && where.main.type === k) ? '' : 'none'; });
			}

			var bar = E('div', { 'class': 'vh-tabs', 'role': 'tablist' });
			function open(id, push) {
				if (!tabs[id]) id = 'ikev2';
				curType = id;
				Object.keys(tabs).forEach(function(k) { tabs[k].btn.classList.toggle('on', k === id); });
				if (tabs[id].btn.scrollIntoView && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = tabs[id].btn.offsetLeft - (bar.clientWidth - tabs[id].btn.offsetWidth) / 2;
				if (push && location.hash !== '#' + id) history.pushState(null, '', '#' + id);
				body.innerHTML = '';
				body.appendChild(E('div', { 'class': 'spinning', 'style': 'padding:24px' }, T('در حال بارگذاری…', 'Loading…')));
				return page.tab(id).then(function(r) {
					if (curType !== id) return;
					body.innerHTML = '';
					body.appendChild(r.node);
					profs = (id === 'settings') ? [] : page.parse(r.data).prof;
					paintMap();
				});
			}
			page.types().concat([ { id: 'settings', name: T('تنظیمات', 'Settings') } ]).forEach(function(t) {
				var live = E('span', { 'class': 'live', 'style': 'display:none' });
				var btn = E('button', { 'class': 'vh-tab', 'type': 'button', 'role': 'tab', 'click': function() { open(t.id, true); } }, [ live, t.name ]);
				tabs[t.id] = { btn: btn, live: live };
				bar.appendChild(btn);
			});
			var onNav = function() { var h = location.hash.slice(1); if (tabs[h] && h !== curType) open(h, false); };
			window.addEventListener('hashchange', onNav); window.addEventListener('popstate', onNav);

			paintMap();
			window.setTimeout(paintMap, 60);
			window.addEventListener('resize', function() { window.clearTimeout(paintMap.t); paintMap.t = window.setTimeout(paintMap, 150); });
			var first = location.hash.slice(1);
			if (!tabs[first]) first = (where.main && tabs[where.main.type]) ? where.main.type : 'ikev2';
			open(first, false);
			poll.add(function() { return ex([ 'where' ]).then(function(o) { if (o) { where = parseWhere(o); paintMap(); } }); }, 15);

			return E('div', { 'class': 'cbi-map', 'dir': DIR, 'style': 'text-align:start' }, [
				cssNode(),
				card(null, [
					E('div', { 'class': 'vh-head' }, [ E('div', { 'style': 'min-width:0' }, [ head, sub ]) ]),
					E('div', { 'class': 'vh-wrap' }, [ svg ]),
					E('div', { 'class': 'vh-tiles' }, [ tExit, tPing, tSrv, tRule ])
				]),
				bar,
				body
			]);
		},
		handleSave: null, handleSaveApply: null, handleReset: null
	});
}

return baseclass.extend({
	home: function() { return homeView(); },
	hub: function() { return hubView(); }
});
