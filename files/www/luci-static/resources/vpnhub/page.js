'use strict';
'require baseclass';
'require view';
'require fs';
'require ui';
'require poll';
'require rpc';
'require vpnhub.en as hubEn';

/* vpnhub - one shared page for every tunnel type. The four menu entries only differ by the type name. */

var NL = String.fromCharCode(10);
/* The text of these pages is Persian in the code; any other panel language gets the English table. */
var FA = (document.documentElement.getAttribute('lang') || '').indexOf('fa') === 0;
var DIR = FA ? 'rtl' : 'ltr';
var ALIGN = FA ? 'right' : 'left';
var LOCALE = FA ? LOCALE : 'en-GB';
function tr(t) { if (FA) return t; var e = hubEn.map[t]; return e === undefined ? t : e; }
var BIN = '/usr/bin/vpnhub';
var INFILE = '/tmp/vpnhub.in';

var TYPES = {
	ikev2: {
		title: tr('تونل IKEv2'), name: 'IKEv2', account: true, bulk: true, body: false,
		accountHint: tr('این حساب برای همه سرورهایی به کار می‌رود که حساب جدا ندارند. نام کاربری و رمز IKEv2 را از سرویس‌دهنده خودتان بگیرید (معمولاً با رمز ورود به سایت فرق دارد).'),
		bulkPlaceholder: 'vpn.example.com Frankfurt'
	},
	l2tp: {
		title: tr('تونل L2TP'), name: 'L2TP', account: true, bulk: true, body: false,
		accountHint: tr('این حساب برای همه سرورهایی به کار می‌رود که حساب جدا ندارند.'),
		bulkPlaceholder: 'l2tp.example.com Istanbul'
	},
	openvpn: {
		title: tr('تونل OpenVPN'), name: 'OpenVPN', account: true, bulk: false, body: true,
		bodyLabel: tr('متن فایل ‎.ovpn'), ports: true, port: true, proto: true,
		accountHint: tr('اگر سرویس‌دهنده شما برای OpenVPN نام کاربری و رمز می‌خواهد، اینجا وارد کنید. برای سرورهایی به کار می‌رود که حساب جدا ندارند.')
	},
	wireguard: {
		title: tr('تونل WireGuard'), name: 'WireGuard', account: false, bulk: false, body: true,
		bodyLabel: tr('متن فایل کانفیگ WireGuard (‎.conf)'), ports: true, port: true, wgkey: true
	},
	amneziawg: {
		title: tr('تونل AmneziaWG'), name: 'AmneziaWG', account: false, bulk: false, body: true,
		bodyLabel: tr('متن فایل کانفیگ AmneziaWG (‎.conf، با خط‌های Jc و S1 و H1 و …)'), ports: true, port: true, wgkey: true
	},
	sstp: {
		title: tr('تونل SSTP'), name: 'SSTP', account: true, bulk: true, body: false, port: true,
		accountHint: tr('این حساب برای همه سرورهایی به کار می‌رود که حساب جدا ندارند.'),
		bulkPlaceholder: 'sstp.example.com Amsterdam'
	},
	v2ray: {
		title: tr('تونل V2Ray / Xray'), name: 'V2Ray', account: false, bulk: true, body: true, link: true,
		bodyLabel: tr('لینک کانفیگ (vless://‎ ، vmess://‎ ، trojan://‎ ، ss://‎ ، hysteria2://‎ ، tuic://‎)'),
		bulkHint: tr('هر خط یک لینک. لینک‌هایی که از قبل در فهرست هستند دوباره اضافه نمی‌شوند.'),
		bulkPlaceholder: 'vless://...'
	}
};

/* The router accepts at most 64 KB per request, and a backup of a few hundred servers is larger: send it in pieces. */
var callFileWrite = rpc.declare({ object: 'file', method: 'write', params: [ 'path', 'data', 'append', 'mode' ], reject: true });
function writeChunked(path, text) {
	var size = 30000, parts = [];
	for (var i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
	if (!parts.length) parts.push('');
	var chain = Promise.resolve();
	parts.forEach(function(part, n) {
		chain = chain.then(function() { return callFileWrite(path, part, n > 0, 384); });
	});
	return chain;
}

/* when the pages are shown as tabs of one page, only the visible tab keeps refreshing */
var hubPoll = null;

/* a round button that shows only a drawing; the word stays as tooltip and as the name screen readers hear */
var ICONS = {
	kick: 'M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.6a10 10 0 0 1 4.3-2.3M15.7 10.9A10 10 0 0 1 19 12.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18',
	ban: 'M12 3a9 9 0 1 0 0.01 0zM5.7 5.7l12.6 12.6',
	unban: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
	edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
	del: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10 10.5v6M14 10.5v6'
};
/* a delay in the reader's language: "113 میلی‌ثانیه" in Persian, so the unit never jumps to the far end of a Persian line */
function msText(n, loss) {
	return FA ? n + ' میلی‌ثانیه' + (+loss > 0 ? ' (' + loss + '٪ گم‌شده)' : '') : n + ' ms' + (+loss > 0 ? ' (' + loss + '% loss)' : '');
}
function iconButton(kind, title, cls, onclick) {
	var NS = 'http://www.w3.org/2000/svg';
	var svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '17'); svg.setAttribute('height', '17'); svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
	svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
	path.setAttribute('d', ICONS[kind]); svg.appendChild(path);
	return E('button', {
		'class': 'cbi-button vh-ib' + (cls || ''), 'type': 'button', 'title': title, 'aria-label': title, 'click': onclick,
		'style': 'width:36px;height:36px;min-height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;flex:none'
	}, [ svg ]);
}

function parse(out) {
	var o = { lease: [], prof: [] };
	(out || '').split(NL).forEach(function(l) {
		var i = l.indexOf('=');
		if (i < 0) return;
		var k = l.slice(0, i), v = l.slice(i + 1).trim();
		if (k === 'lease') {
			var p = v.split('|');
			o.lease.push({ ip: p[0], mac: p[1] || '', name: (p[2] && p[2] !== '*') ? p[2] : '' });
		} else if (k === 'prof') {
			var q = v.split('|');
			o.prof.push({ id: q[0], host: q[1] || '', ip: q[2] || '', label: q[3] || '', own: q[4] === '1', active: q[5] === '1', port: q[6] || '', proto: q[7] || '', group: q[8] || '' });
		} else {
			o[k] = v;
		}
	});
	return o;
}

function ex(args) {
	return L.resolveDefault(fs.exec(BIN, args), { stdout: '' }).then(function(r) {
		return ((r && r.stdout) || '').trim();
	});
}

function csv(text) {
	var a = (text || '').split(/[\s,]+/).filter(function(x) { return x.length > 0; });
	return a.length ? a.join(',') : '-';
}

function wait(ms) {
	return new Promise(function(r) { window.setTimeout(r, ms); });
}

function bad(s) {
	return s.indexOf('"') >= 0 || s.indexOf(String.fromCharCode(92)) >= 0 || s.indexOf(NL) >= 0;
}

/* Sections that belong to the whole program, shown on the settings page. */
function busyModal(title, job) {
	ui.showModal(title, [ E('p', { 'class': 'spinning' }, tr('لطفاً صبر کنید…')) ]);
	return job().then(function(msg) {
		ui.hideModal();
		if (msg) ui.addNotification(null, E('p', {}, msg), 'info');
	}, function(e) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, tr('خطا: ') + (e && e.message ? e.message : e)), 'danger');
	});
}

function sharedSections(d) {
	var busy = busyModal;
	var reloadAll = function() { return Promise.resolve(); };
	var sec = function(title, children) {
		return E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [ E('h3', {}, title) ].concat(children));
	};
	var hint = function(t) { return E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, t); };
	var routing = [], backup = [], page;
	/* --- routing (shared by every tunnel type) --- */
	var cbIran = E('input', { 'type': 'checkbox' });
	cbIran.checked = d.iran_direct !== '0';
	var cbAll = E('input', { 'type': 'checkbox' });
	cbAll.checked = d.all_devices !== '0';
	var iranCount = E('span', { 'dir': 'ltr' }, d.iran_count || '0');
	var iranDoms = E('span', { 'dir': 'ltr' }, d.iran_domains || '0');

	var saved = (d.devices || '').split(',').filter(function(x) { return x; });
	var rows = d.lease.slice();
	saved.forEach(function(ip) {
		if (!rows.some(function(r) { return r.ip === ip; })) rows.push({ ip: ip, mac: '', name: '' });
	});
	rows.sort(function(a, b) { return a.ip.localeCompare(b.ip, undefined, { numeric: true }); });
	var devBoxes = [];
	var devList = E('div', { 'style': 'margin:6px 0 0 0;padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px' },
		rows.length ? rows.map(function(r) {
			var cb = E('input', { 'type': 'checkbox', 'data-ip': r.ip });
			cb.checked = saved.indexOf(r.ip) >= 0;
			devBoxes.push(cb);
			return E('label', { 'style': 'display:block;margin:3px 0' }, [
				cb, ' ',
				E('span', { 'dir': 'ltr' }, r.ip),
				r.name ? E('span', {}, ' — ' + r.name) : ''
			]);
		}) : [ E('em', {}, tr('دستگاهی در فهرست روتر پیدا نشد.')) ]);
	function syncDev() { devList.style.display = cbAll.checked ? 'none' : ''; }
	cbAll.addEventListener('change', syncDev);
	syncDev();

	var taStyle = 'width:100%;max-width:34em;height:7em;direction:ltr;text-align:left;font-family:monospace';
	var taDirect = E('textarea', { 'class': 'cbi-input-textarea', 'style': taStyle }, (d.direct || '').split(',').filter(function(x) { return x; }).join(NL));
	var inDns = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'placeholder': '1.1.1.1, 8.8.8.8', 'value': (d.tunnel_dns || '').split(',').filter(function(x) { return x; }).join(', ') });
	function saveDns() {
		var v = inDns.value.split(/[\s,]+/).filter(function(x) { return /^\d+\.\d+\.\d+\.\d+$/.test(x); }).join(',');
		if (inDns.value.trim() && !v) { ui.addNotification(null, E('p', {}, tr('نشانی DNS باید عددی باشد، مثل 1.1.1.1')), 'warning'); return Promise.resolve(); }
		return ex(['dns-set', v || '-']).then(function(o) {
			var m = /^saved (.*)$/m.exec(o);
			ui.addNotification(null, E('p', {}, m ? tr('ذخیره شد. DNS داخل تونل: ') + m[1].split(',').join(tr(' و ')) : tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'))), 'info');
		});
	}
	var taTunnel = E('textarea', { 'class': 'cbi-input-textarea', 'style': taStyle }, (d.tunnel || '').split(',').filter(function(x) { return x; }).join(NL));

	function save() {
		var devs = devBoxes.filter(function(c) { return c.checked; }).map(function(c) { return c.getAttribute('data-ip'); });
		if (!cbAll.checked && !devs.length) {
			ui.addNotification(null, E('p', {}, tr('هیچ دستگاهی انتخاب نشده است. یا «همه دستگاه‌ها» را بزنید یا دست‌کم یک دستگاه را تیک بزنید.')), 'warning');
			return Promise.resolve();
		}
		return busy(tr('در حال ذخیره و اعمال'), function() {
			return ex(['save', cbIran.checked ? '1' : '0', cbAll.checked ? '1' : '0', devs.length ? devs.join(',') : '-', csv(taDirect.value), csv(taTunnel.value)])
				.then(function(o) {
					if (/saved and applied/.test(o)) return tr('ذخیره شد و همین حالا اعمال شد.');
					if (/applying failed/.test(o)) return tr('ذخیره شد، ولی اعمالش خطا داد. یکی از خط‌های فهرست‌ها را بررسی کنید.');
					if (/saved/.test(o)) return tr('ذخیره شد. با وصل شدن تونل اعمال می‌شود.');
					return tr('جواب روتر: ') + (o || tr('خالی'));
				});
		});
	}

	function iranUpdate() {
		return busy(tr('در حال به‌روزرسانی فهرست ایران'), function() {
			return ex(['iran-update']).then(function(o) {
				var m = /updated ips=(\S+) domains=(\S+)/.exec(o);
				if (!m || (m[1] === '-' && m[2] === '-')) return tr('به‌روزرسانی انجام نشد (فهرست تازه دانلود نشد یا درست نبود)؛ همان فهرست قبلی سر جایش است.');
				if (m[1] !== '-') iranCount.textContent = m[1];
				if (m[2] !== '-') iranDoms.textContent = m[2];
				if (m[1] === '-') return tr('فهرست سایت‌ها به‌روز شد، ولی فهرست بازه‌های نشانی دانلود نشد و همان قبلی ماند.');
				if (m[2] === '-') return tr('فهرست بازه‌های نشانی به‌روز شد، ولی فهرست سایت‌ها دانلود نشد و همان قبلی ماند.');
				return tr('هر دو فهرست ایران به‌روز شد.');
			});
		});
	}

	/* --- backup: take the server lists to another router --- */
	var inImport = E('input', { 'type': 'file', 'accept': '.vpnhub,.gz,.tgz' });
	function doExport() {
		return busy(tr('در حال ساختن فایل'), function() {
			return ex(['export']).then(function(o) {
				var b64 = (o || '').replace(/\s+/g, '');
				if (b64.length < 40) return tr('فایل ساخته نشد. جواب روتر: ') + (o || tr('خالی'));
				var bin = window.atob(b64), arr = new Uint8Array(bin.length);
				for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
				var url = window.URL.createObjectURL(new Blob([ arr ], { type: 'application/gzip' }));
				var a = document.createElement('a');
				a.href = url;
				a.download = 'vpnhub-servers-' + new Date().toISOString().slice(0, 10) + '.vpnhub';
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				window.setTimeout(function() { window.URL.revokeObjectURL(url); }, 5000);
				return tr('فایل دانلود شد. فقط فهرست سرورها در آن است؛ نام کاربری، رمز و کلید در آن نیست.');
			});
		});
	}
	function doImport() {
		var f = inImport.files && inImport.files[0];
		if (!f) {
			ui.addNotification(null, E('p', {}, tr('اول فایل پشتیبان را انتخاب کنید.')), 'warning');
			return Promise.resolve();
		}
		return busy(tr('در حال بازگردانی'), function() {
			return new Promise(function(resolve, reject) {
				var rd = new FileReader();
				rd.onload = function() { resolve(String(rd.result || '').replace(/^data:[^,]*,/, '')); };
				rd.onerror = function() { reject(new Error(tr('فایل خوانده نشد'))); };
				rd.readAsDataURL(f);
			}).then(function(b64) {
				return writeChunked(INFILE, b64 + NL);
			}).then(function() {
				return ex(['import']);
			}).then(function(o) {
				if (o.indexOf('started') !== 0) return o;
				var tries = 0;
				var again = function() {
					return wait(2000).then(function() { return ex(['import-status']); }).then(function(st) {
						tries++;
						if ((st === 'running' || st === '') && tries < 150) return again();
						return st;
					});
				};
				return again();
			}).then(function(o) {
				var m = /imported (\d+) skipped (\d+)/.exec(o);
				return reloadAll().then(function() {
					if (m) return m[1] + tr(' سرور از فایل وارد شد (در همه صفحه‌های تونل)') + (+m[2] > 0 ? tr(' و ') + m[2] + tr(' سرور که از قبل اینجا بود دست‌نخورده ماند') : '') + tr('. حالا نام کاربری و رمز را در بخش «حساب پیش‌فرض» هر صفحه، و کلید وایرگارد را در بخش «کلید شخصی» وارد کنید.');
					return tr('این فایل، فایل پشتیبان vpnhub نیست یا خراب است. چیزی عوض نشد.');
				});
			});
		});
	}

	function doDeleteAll() {
		if (!window.confirm(tr('همه سرورهای همه تونل‌ها (IKEv2، L2TP، OpenVPN، WireGuard، AmneziaWG، SSTP و V2Ray) حذف شوند؟'))) return Promise.resolve();
		if (!window.confirm(tr('مطمئنید؟ این کار برگشت ندارد، مگر اینکه قبلاً فایل پشتیبان گرفته باشید. نام کاربری و رمزهای ذخیره‌شده حذف نمی‌شوند.'))) return Promise.resolve();
		return busy(tr('در حال حذف همه سرورها'), function() {
			return ex(['prof-del-everything']).then(function(o) {
				window.setTimeout(function() { window.location.reload(); }, 800);
				return tr('همه سرورها حذف شدند. ') + o;
			});
		});
	}

	page = routing;
	page.push(sec(tr('مسیردهی'), [
		E('label', { 'style': 'display:block;margin:6px 0' }, [ cbIran, tr(' سایت‌ها و سرویس‌های ایرانی مستقیم بروند (بدون تونل)') ]),
		hint([ tr('هر مقصدی که سرورش در ایران باشد مستقیم می‌رود، به‌علاوه همه نشانی‌های ‎.ir و سایت‌های شناخته‌شده ایرانی که ‎.ir نیستند. فهرست فعلی: '), iranCount, tr(' بازه نشانی و '), iranDoms, tr(' سایت. '),
			E('button', { 'class': 'cbi-button', 'style': 'margin-inline-start:8px', 'click': iranUpdate }, tr('به‌روزرسانی فهرست')) ]),
		E('label', { 'style': 'display:block;margin:10px 0 0 0' }, [ cbAll, tr(' همه دستگاه‌های متصل به روتر از تونل استفاده کنند') ]),
		devList,
		E('div', { 'style': 'display:flex;gap:18px;flex-wrap:wrap;margin-top:14px' }, [
			E('div', { 'style': 'flex:1;min-width:16em' }, [
				E('strong', {}, tr('همیشه مستقیم')),
				hint(tr('هر خط یک مورد: دامنه، نشانی یا بازه نشانی. این‌ها هیچ‌وقت از تونل نمی‌روند. این فهرست مال خود شماست و به‌روزرسانی به آن دست نمی‌زند.')),
				taDirect
			]),
			E('div', { 'style': 'flex:1;min-width:16em' }, [
				E('strong', {}, tr('همیشه از تونل')),
				hint(tr('هر خط یک مورد. این‌ها همیشه از تونل می‌روند، حتی اگر سرورشان در ایران باشد.')),
				taTunnel
			])
		]),
		E('div', { 'style': 'margin-top:12px' }, [
			E('button', { 'class': 'cbi-button cbi-button-save', 'click': save }, tr('ذخیره و اعمال'))
		]),
		hint(tr('بعد از تغییر فهرست دامنه‌ها، ممکن است چند دقیقه طول بکشد تا دستگاه‌ها نشانی تازه را بگیرند.')),
		E('div', { 'style': 'margin-top:16px' }, [ E('strong', {}, tr('DNS داخل تونل')) ]),
		hint(tr('وقتی تونل روشن است، اسم سایت‌ها از داخل تونل از این نشانی‌ها پرسیده می‌شود. اگر خالی باشد 1.1.1.1 و 8.8.8.8 به کار می‌رود. فقط وقتی عوضش کنید که سرویس‌دهنده شما DNS خودش را دارد (مثلاً برای حذف تبلیغ) یا این دو نشانی از داخل تونلش باز نمی‌شوند. سایت‌های ایرانی همچنان از DNS خود خط پرسیده می‌شوند.')),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
			E('label', {}, [ tr('نشانی‌ها '), inDns ]),
			E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveDns }, tr('ذخیره DNS'))
		])
	]));

	page = backup;
	page.push(sec(tr('پشتیبان و انتقال به روتر دیگر'), [
		hint(tr('فایل پشتیبان فقط فهرست سرورهای همه تونل‌ها (اسم، نشانی، درگاه و متن کانفیگ) و دو فهرست «همیشه مستقیم» و «همیشه از تونل» را دارد. نام کاربری، رمز و کلید در آن نیست و روی روتر دیگر باید خودتان دوباره واردشان کنید. سرورهای قبلی آن روتر سر جایشان می‌مانند.')),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0' }, [
			E('button', { 'class': 'cbi-button cbi-button-action', 'click': doExport }, tr('دانلود فایل پشتیبان'))
		]),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
			inImport,
			E('button', { 'class': 'cbi-button cbi-button-apply', 'click': doImport }, tr('بازگردانی از فایل'))
		]),
		E('div', { 'style': 'margin-top:18px' }, [ E('strong', {}, tr('حذف همه سرورها')) ]),
		hint(tr('همه سرورهای همه تونل‌ها را یک‌جا پاک می‌کند. اگر تونلی روشن باشد اول خاموش می‌شود. بهتر است قبلش «دانلود فایل پشتیبان» را بزنید. اگر اشتراک V2Ray دارید، روتر روزی یک بار سرورهای آن را دوباره اضافه می‌کند.')),
		E('div', { 'style': 'margin:6px 0' }, [
			E('button', { 'class': 'cbi-button cbi-button-negative', 'click': doDeleteAll }, tr('حذف همه سرورها'))
		])
	]));

	return { routing: routing, backup: backup };
}

function makeView(type) {
	var T = TYPES[type];

	return view.extend({
		load: function() {
			return ex(['get', type]);
		},

		render: function(out) {
			var d = parse(out);

			/* one line: a coloured chip, the name of the server, and a few words when the tunnel is not carrying traffic */
			var state = E('span', { 'class': 'vh-chip' }, '');
			var where = E('strong', { 'class': 'vh-where', 'dir': 'auto' }, '');
			var note = E('span', { 'class': 'vh-note' }, '');
			var info = E('div', { 'class': 'vh-status' }, [ state, where, note ]);
			var warnMissing = E('div', { 'class': 'alert-message warning', 'style': d.missing === '1' ? '' : 'display:none' },
				tr('برنامه لازم برای ') + T.name + tr(' روی این روتر نصب نیست. نصب‌کننده vpnhub را دوباره اجرا کنید.'));

			/* --- automatic switch to a backup server --- */
			var cbFail = E('input', { 'type': 'checkbox' });
			var failInfo = E('div', { 'style': 'opacity:.75;font-size:90%' }, tr('روتر به همه سرورهای همین نوع تونل پینگ می‌زند، پنج سروری را که کمترین پینگ را دارند به نوبت امتحان می‌کند و روی اولی که واقعاً وصل شد می‌ماند. اگر هیچ‌کدام وصل نشد، به سرور قبلی برمی‌گردد و دوباره تلاش می‌کند. ممکن است سرور تازه در کشور دیگری باشد.'));
			cbFail.addEventListener('change', function() { ex(['failover', cbFail.checked ? '1' : '0']); });

			function paint(x) {
				var on = x.connected === '1';
				var other = x.active_type && x.active_type !== type;
				var trying = !on && !other && x.enabled === '1';
				state.textContent = on ? tr('وصل') : (trying ? tr('در حال وصل شدن…') : tr('خاموش'));
				state.setAttribute('data-s', on ? 'on' : (trying ? 'try' : 'off'));
				where.textContent = x.server ? (x.label || x.server) : tr('هنوز سروری انتخاب نشده');
				/* the long details stay one hover away */
				where.title = x.server ? x.server + (x.server_ip && x.server_ip !== x.server ? ' (' + x.server_ip + ')' : '') + (on && x.vip ? ' · ' + x.vip : '') : '';
				note.textContent = on ? '' : (other ? tr('تونل ') + (TYPES[x.active_type] ? TYPES[x.active_type].name : x.active_type) + tr(' فعال است') : tr('همه دستگاه‌ها روی خط مستقیم‌اند'));
				cbFail.checked = x.failover === '1';
			}

			function refresh() {
				return ex(['get', type]).then(function(o) { if (o) paint(parse(o)); });
			}

			function busy(title, job) {
				ui.showModal(title, [ E('p', { 'class': 'spinning' }, tr('لطفاً صبر کنید…')) ]);
				return job().then(function(msg) {
					ui.hideModal();
					if (msg) ui.addNotification(null, E('p', {}, msg), 'info');
				}, function(e) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, tr('خطا: ') + (e && e.message ? e.message : e)), 'danger');
				});
			}

			/* --- servers --- */
			var srvBody = E('tbody', {});
			var pingCells = {}, probeCells = {};
			var srvList = [], pingRes = {}, probeRes = {};
			var probeInfo = E('div', { 'style': 'margin:6px 0' }, '');
			var inSite = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:20em;max-width:100%', 'list': 'vpnhub-sites', 'value': 'https://gemini.google.com/app' });
			var inTarget = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'list': 'vpnhub-targets', 'value': '1.1.1.1' });
			var taAdd = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:34em;height:5em;direction:ltr;text-align:left;font-family:monospace', 'placeholder': T.bulkPlaceholder || '' });
			var inFilter = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:16em;max-width:100%', 'placeholder': tr('جستجو: شهر یا اسم سرور') });
			inFilter.addEventListener('input', function() { renderServers(srvList); });
			var selCount = E('select', { 'class': 'cbi-input-select' }, [
				E('option', { 'value': '5' }, '5'), E('option', { 'value': '10', 'selected': 'selected' }, '10'),
				E('option', { 'value': '15' }, '15'), E('option', { 'value': '25' }, '25')
			]);
			var srvCount = E('span', { 'style': 'opacity:.75' }, '');
			/* servers from one source (a subscription, a provider) stay together; the chips show one group at a time */
			var grpSel = '', grpBar = E('div', { 'class': 'vh-chips' });

			/* real connection check: a ping to the server's address only says the machine is on. After "ping all" the page
			   connects for real (with the saved account) to the servers with the lowest ping and shows, for those, the time
			   measured through the tunnel or "does not connect". WireGuard and AmneziaWG keep their own handshake test (portTest) */
			var REAL = !(T.ports && !T.proto);
			var REAL_TOP = 10;
			var realRes = {}, realNow = '', realRunning = false, realPolling = false;
			var realInfo = E('span', { 'style': 'opacity:.85' }, '');
			var hasReal = function() { return Object.keys(realRes).length > 0; };

			function reloadAll() {
				return ex(['get', type]).then(function(o) { var x = parse(o); paint(x); renderServers(x.prof); if (REAL && !realPolling) loadReal(); });
			}

			function loadReal() {
				realPolling = true;
				return ex(['real-status', type]).then(function(o) {
					var x = {}; realRes = {};
					o.split(NL).forEach(function(l) {
						var i = l.indexOf('=');
						if (i < 0) return;
						var k = l.slice(0, i), v = l.slice(i + 1);
						if (k === 'real') { var p = v.split('|'); realRes[p[0]] = { ms: p[1], note: p[2] }; } else x[k] = v;
					});
					var wasRunning = realRunning;
					realRunning = x.real_running === '1';
					realNow = realRunning ? (x.real_now || '') : '';
					var good = Object.keys(realRes).filter(function(k) { return realRes[k].ms; }).length;
					if (realRunning) realInfo.textContent = tr('در حال بررسی اتصال واقعی سرورهای کم‌پینگ: ') + (x.real_done || 0) + tr(' از ') + (x.real_total || '?') + tr(' — وصل شد: ') + good;
					else if (hasReal()) realInfo.textContent = tr('از ') + Object.keys(realRes).length + tr(' سرور کم‌پینگ، ') + good + tr(' سرور واقعاً وصل شد.');
					else realInfo.textContent = '';
					renderServers(srvList);
					if (realRunning) return wait(3000).then(loadReal);
					realPolling = false;
					if (wasRunning) return ex(['get', type]).then(function(o) { var y = parse(o); paint(y); renderServers(y.prof); });
				}, function() { realPolling = false; });
			}

			/* runs by itself right after "ping all": the REAL_TOP servers with the lowest ping are connected to for real */
			function realAuto() {
				var ids = srvList.filter(function(sv) { return pingRes[sv.id] && pingRes[sv.id].avg; })
					.sort(function(a, b) { return +pingRes[a.id].avg - +pingRes[b.id].avg; })
					.slice(0, REAL_TOP).map(function(sv) { return sv.id; });
				if (!ids.length) return Promise.resolve();
				realRes = {};
				renderServers(srvList);
				return ex(['real-all', type, '0', ids.join(',')]).then(function(o) {
					if (o.indexOf('started') !== 0) return;
					realRunning = true;
					realInfo.textContent = tr('در حال بررسی اتصال واقعی سرورهای کم‌پینگ…');
					return wait(2500).then(function() { if (!realPolling) return loadReal(); });
				});
			}

			function realCell(pc, sv) {
				var r = realRes[sv.id];
				pc.title = tr('زمان رفت‌وبرگشت واقعی از داخل تونل، بعد از وصل شدن به همین سرور با حساب ذخیره‌شده');
				pc.style.color = '';
				if (!r) { pc.textContent = (realRunning && realNow === sv.id) ? tr('در حال وصل شدن…') : '—'; return; }
				if (r.ms) {
					var ms = +r.ms;
					pc.textContent = msText(ms);
					pc.style.color = ms < 130 ? '#2e9e4f' : (ms < 220 ? '#d68910' : '#c0392b');
					return;
				}
				pc.textContent = r.note === 'no account' ? tr('حساب وارد نشده') : tr('وصل نمی‌شود');
				pc.style.color = '#c0392b';
			}

			function useServer(sv) {
				return busy(tr('در حال وصل شدن به سرور'), function() {
					return ex(['use', sv.id]).then(function(o) {
						if (!/server set to/.test(o)) return reloadAll().then(function() { return tr('سرور عوض نشد. جواب روتر: ') + (o || tr('خالی')); });
						return wait(16000).then(reloadAll).then(function() { return ''; });
					});
				});
			}

			function delServer(sv) {
				if (!window.confirm('«' + (sv.label || sv.host) + tr('» از فهرست حذف شود؟'))) return Promise.resolve();
				return ex(['prof-del', sv.id]).then(reloadAll);
			}

			/* group delete: the button shows a tick box on every row and an "all" box in the header; the ticked servers are deleted together */
			var bulk = false, picked = {};
			var thAct = E('th', { 'class': 'th', 'style': 'white-space:nowrap' }, '');
			var btnBulk = E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() { setBulk(!bulk); } }, tr('حذف گروهی'));
			var btnGo = E('button', { 'class': 'cbi-button cbi-button-negative', 'style': 'display:none', 'click': function() { return delPicked(); } }, '');
			function setBulk(on) {
				bulk = on;
				picked = {};
				btnBulk.textContent = on ? tr('انصراف') : tr('حذف گروهی');
				renderServers(srvList);
			}
			function updateBulkUi(rows) {
				var n = Object.keys(picked).length;
				btnGo.style.display = bulk ? '' : 'none';
				btnGo.textContent = tr('حذف انتخاب‌شده') + ' (' + n + ')';
				btnGo.disabled = !n;
				thAct.innerHTML = '';
				if (!bulk) return;
				var all = E('input', { 'type': 'checkbox' });
				all.checked = rows.length > 0 && rows.every(function(sv) { return picked[sv.id]; });
				all.addEventListener('change', function() {
					rows.forEach(function(sv) { if (all.checked) picked[sv.id] = 1; else delete picked[sv.id]; });
					renderServers(srvList);
				});
				thAct.appendChild(E('label', { 'style': 'display:inline-flex;gap:6px;align-items:center;cursor:pointer' }, [ all, tr('همه') ]));
			}
			function delPicked() {
				var ids = Object.keys(picked);
				if (!ids.length) return Promise.resolve();
				var msg = tr('سرورهای انتخاب‌شده حذف شوند؟ تعداد: ') + ids.length;
				if (type === 'v2ray') msg += '\n' + tr('اگر اشتراک (Subscription) دارید، روتر روزی یک بار سرورهای آن را دوباره اضافه می‌کند؛ برای حذف همیشگی نشانی اشتراک را هم پاک کنید.');
				if (!window.confirm(msg)) return Promise.resolve();
				return busy(tr('در حال حذف سرورها'), function() {
					return ex([ 'prof-del-many', type, ids.join(',') ]).then(function() {
						bulk = false; picked = {};
						btnBulk.textContent = tr('حذف گروهی');
						return reloadAll();
					}).then(function() { return ''; });
				});
			}

			/* add / edit one server */
			function editServer(sv) {
				var isNew = !sv;
				var row = function(label, el, note) {
					return E('label', { 'style': 'display:block;margin:8px 0' }, [ E('div', {}, label), el, note ? E('div', { 'style': 'opacity:.7;font-size:90%' }, note) : '' ]);
				};
				var w = 'width:100%;max-width:30em';
				var fLabel = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': w });
				var grpList = E('datalist', { 'id': 'vh-groups-' + type }, (srvList || []).map(function(v) { return v.group; }).filter(function(g, i, a) { return g && a.indexOf(g) === i; }).map(function(g) { return E('option', { 'value': g }); }));
				var fGroup = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': w, 'list': 'vh-groups-' + type, 'placeholder': tr('خودکار') });
				var fServer = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w, 'placeholder': 'vpn.example.com' });
				var fPort = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:8em', 'placeholder': T.ports ? '' : '443' });
				var fRid = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w });
				var fProto = E('select', { 'class': 'cbi-input-select', 'dir': 'ltr' }, [ E('option', { 'value': '' }, '—'), E('option', { 'value': 'udp' }, 'UDP'), E('option', { 'value': 'tcp' }, 'TCP') ]);
				var fUser = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w, 'autocomplete': 'off' });
				var fPass = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': w, 'autocomplete': 'new-password' });
				var fIpsec = E('input', { 'type': 'checkbox' });
				var fPsk = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': w, 'autocomplete': 'new-password' });
				var fBody = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:38em;height:11em;direction:ltr;text-align:left;font-family:monospace;font-size:90%' });
				var fFile = E('input', { 'type': 'file' });
				fFile.addEventListener('change', function() {
					var f = fFile.files && fFile.files[0];
					if (!f) return;
					var rd = new FileReader();
					rd.onload = function() {
						fBody.value = String(rd.result || '');
						if (!fLabel.value) fLabel.value = f.name.replace(/\.(ovpn|conf)$/i, '');
					};
					rd.readAsText(f);
				});
				var pskRow = row(tr('کلید مشترک IPsec'), fPsk, isNew ? '' : tr('خالی بگذارید تا همان کلید قبلی بماند.'));
				function syncPsk() { pskRow.style.display = fIpsec.checked ? '' : 'none'; }
				fIpsec.addEventListener('change', syncPsk);

				var body = [];
				body.push(row(tr('اسم دلخواه'), fLabel, T.link ? tr('اگر خالی باشد، اسمی که داخل لینک نوشته شده به کار می‌رود.') : ''));
				body.push(row(tr('گروه'), E('div', {}, [ fGroup, grpList ]), tr('سرورهای یک منبع (یک اشتراک یا یک سرویس‌دهنده) کنار هم نشان داده می‌شوند. خالی بگذارید تا خودکار تعیین شود.')));
				if (T.body) {
					body.push(row(T.bodyLabel, fBody, T.link ? (isNew ? tr('لینک را اینجا بچسبانید.') : tr('خالی بگذارید تا همان لینک قبلی بماند.')) : (isNew ? tr('متن فایل را اینجا بچسبانید یا با دکمه زیر فایل را انتخاب کنید.') : tr('خالی بگذارید تا همان کانفیگ قبلی بماند.'))));
					if (!T.link) body.push(E('div', { 'style': 'margin:-4px 0 8px 0' }, fFile));
				} else {
					body.push(row(tr('نشانی سرور'), fServer));
				}
				if (T.port) body.push(row(tr('درگاه (اختیاری)'), fPort, T.ports ? tr('اگر خالی باشد، همان درگاهی که در متن کانفیگ (خط Endpoint) هست به کار می‌رود. اگر تست درگاه نشان داد درگاه دیگری باز است، شماره‌اش را اینجا بنویسید.') : tr('اگر خالی باشد 443 به کار می‌رود.')));
				if (T.proto) body.push(row(tr('پروتکل (اختیاری)'), fProto, tr('اگر انتخاب نشود، همان که در متن کانفیگ هست به کار می‌رود.')));
				if (type === 'ikev2') body.push(row(tr('شناسه سرور (اختیاری)'), fRid, tr('فقط وقتی لازم است که اسم روی گواهی سرور با نشانی سرور فرق داشته باشد.')));
				if (T.account) {
					body.push(row(tr('نام کاربری') + (T.account ? tr(' (اختیاری)') : ''), fUser, T.account ? tr('اگر خالی باشد، حساب پیش‌فرض همین صفحه به کار می‌رود.') : ''));
					body.push(row(tr('رمز'), fPass, isNew ? '' : tr('خالی بگذارید تا همان رمز قبلی بماند.')));
				}
				if (type === 'l2tp') {
					body.push(E('label', { 'style': 'display:block;margin:8px 0' }, [ fIpsec, tr(' رمزگذاری IPsec با کلید مشترک (L2TP/IPsec)') ]));
					body.push(pskRow);
				}
				syncPsk();

				function submit() {
					var lab = fLabel.value.trim(), srv = fServer.value.trim(), u = fUser.value.trim(), p = fPass.value, k = fPsk.value, rid = fRid.value.trim();
					if (bad(lab + u + p + k + rid)) { window.alert(tr('علامت نقل‌قول دوتایی و بک‌اسلش در اسم، نام کاربری، رمز و کلید پشتیبانی نمی‌شود.')); return; }
					if (!T.body && !srv) { window.alert(tr('نشانی سرور را بنویسید.')); return; }
					if (T.body && isNew && !fBody.value.trim()) { window.alert(T.link ? tr('لینک را وارد کنید.') : tr('متن کانفیگ را وارد کنید.')); return; }
					var lines = [ 'id=' + (isNew ? 'new' : sv.id), 'type=' + type, 'label=' + lab, 'group=' + fGroup.value.trim() ];
					if (!T.body) lines.push('server=' + srv);
					lines.push('port=' + fPort.value.trim(), 'proto=' + fProto.value, 'rid=' + rid, 'user=' + u, 'pass=' + p, 'ipsec=' + (fIpsec.checked ? '1' : '0'), 'psk=' + k, '---');
					var text = lines.join(NL) + NL + (T.body ? fBody.value : '') + NL;
					ui.hideModal();
					return busy(tr('در حال ذخیره'), function() {
						return fs.write(INFILE, text, 384).then(function() { return ex(['prof-save']); }).then(function(o) {
							return reloadAll().then(function() {
								if (/^saved /.test(o)) return /warning:/.test(o) ? tr('ذخیره شد، ولی نشانی واقعی سرور الان پیدا نشد. اسم سرور را بررسی کنید.') : tr('ذخیره شد.');
								var why = {
									'bad server': T.link ? tr('این لینک خوانده نشد یا این نوع لینک پشتیبانی نمی‌شود.') : (tr('نشانی سرور درست نیست') + (T.body ? tr(' یا در متن کانفیگ پیدا نشد.') : '.')),
									'empty password': tr('برای این نام کاربری رمز وارد نشده است.'),
									'empty pre-shared key': tr('کلید مشترک IPsec وارد نشده است.'),
									'empty config': tr('متن کانفیگ خالی است.'),
									'bad characters': tr('علامت نقل‌قول دوتایی یا بک‌اسلش در ورودی هست.')
								};
								return tr('ذخیره نشد. ') + (why[o] || (tr('جواب روتر: ') + (o || tr('خالی'))));
							});
						});
					});
				}

				var open = function(x) {
					if (x) {
						fLabel.value = x.LABEL || ''; fGroup.value = x.GROUP || ''; fServer.value = x.SERVER || ''; fRid.value = x.RID || ''; fPort.value = x.PORT || ''; fProto.value = (x.PROTO === 'tcp' || x.PROTO === 'udp') ? x.PROTO : ''; fUser.value = x.USER || '';
						fIpsec.checked = x.IPSEC === '1';
						if (x.HAS_PASS) fPass.setAttribute('placeholder', tr('(ذخیره شده)'));
						if (x.HAS_PSK) fPsk.setAttribute('placeholder', tr('(ذخیره شده)'));
						if (x.HAS_BODY) fBody.setAttribute('placeholder', tr('(کانفیگ ذخیره شده است)'));
						syncPsk();
					}
					ui.showModal(isNew ? tr('افزودن سرور ') + T.name : tr('ویرایش «') + (sv.label || sv.host) + '»', [
						E('div', { 'dir': DIR, 'style': 'text-align:' + ALIGN }, body.concat([
							E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, [
								E('button', { 'class': 'cbi-button cbi-button-action', 'click': submit }, tr('ذخیره')),
								E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, tr('انصراف'))
							])
						]))
					]);
				};
				if (isNew) return open(null);
				return ex(['prof-get', sv.id]).then(function(o) {
					var x = {};
					o.split(NL).forEach(function(l) { var i = l.indexOf('='); if (i > 0) x[l.slice(0, i)] = l.slice(i + 1); });
					open(x);
				});
			}

			function cellText(c, r, failText) {
				c.classList.toggle('vh-empty', !r);
				if (!r) { c.textContent = '—'; c.style.color = ''; return; }
				if (r.site) {
					var code = +r.code || 0, sec = r.sec ? ' ' + (+r.sec).toFixed(1) + 's' : '';
					if (r.note) { c.textContent = r.note; c.style.color = '#c0392b'; }
					else if (!r.code) { c.textContent = failText; c.style.color = '#c0392b'; }
					else if (code >= 200 && code < 400) { c.textContent = tr('باز شد (') + code + ')' + sec; c.style.color = '#2e9e4f'; }
					else if (code === 403 || code === 451) { c.textContent = tr('رد شد (') + code + ')'; c.style.color = '#c0392b'; }
					else if (code === 0) { c.textContent = tr('جواب نداد'); c.style.color = '#c0392b'; }
					else { c.textContent = tr('خطا (') + code + ')'; c.style.color = '#d68910'; }
					return;
				}
				if (r.avg) {
					var ms = Math.round(+r.avg);
					c.textContent = msText(ms, r.loss);
					c.style.color = ms < 130 ? '#2e9e4f' : (ms < 220 ? '#d68910' : '#c0392b');
				} else {
					c.textContent = r.note || failText;
					c.style.color = '#c0392b';
				}
			}

			function renderServers(list) {
				srvList = list;
				srvBody.innerHTML = '';
				pingCells = {};
				probeCells = {};
				var f = inFilter.value.trim().toLowerCase();
				var gname = function(g) { return g || tr('بدون گروه'); };
				var gcount = {}, gorder = [];
				list.forEach(function(sv) { if (!(sv.group in gcount)) { gcount[sv.group] = 0; gorder.push(sv.group); } gcount[sv.group]++; });
				gorder.sort(function(a, b) { return (gcount[b] - gcount[a]) || gname(a).localeCompare(gname(b)); });
				if (grpSel && !(grpSel in gcount)) grpSel = '';
				grpBar.innerHTML = '';
				if (gorder.length > 1) {
					var chip = function(g, text, n) {
						return E('button', { 'type': 'button', 'class': 'vh-chip2' + (grpSel === g ? ' on' : ''), 'click': function() { grpSel = g; renderServers(srvList); } }, [ text, E('span', {}, String(n)) ]);
					};
					grpBar.appendChild(chip('', tr('همه'), list.length));
					gorder.forEach(function(g) { grpBar.appendChild(chip(g || '\u0000', gname(g), gcount[g])); });
				}
				var inGrp = function(sv) { return !grpSel || (grpSel === '\u0000' ? !sv.group : sv.group === grpSel); };
				var rows = list.filter(function(sv) { return inGrp(sv) && (!f || (sv.label + ' ' + sv.host + ' ' + sv.group).toLowerCase().indexOf(f) >= 0); });
				var hasPing = Object.keys(pingRes).length > 0 || (REAL && hasReal());
				var key = function(sv) {
					if (sv.active) return -1;
					var q = REAL ? realRes[sv.id] : null;
					if (q) return q.ms ? +q.ms : 99999;
					var r = pingRes[sv.id], h = portRes[sv.id];
					if (h && h.open !== '…' && h.open !== 'active' && (!h.open || h.open === 'error')) return 99998;
					return (hasPing && r && r.avg) ? +r.avg : (hasPing ? 99999 : 0);
				};
				/* when every group is shown, the list goes group by group (the biggest first), each sorted as before */
				var heads = !grpSel && gorder.length > 1;
				var gi = {}; gorder.forEach(function(g, i) { gi[g] = i; });
				rows = rows.map(function(sv, i) { return { sv: sv, i: i }; }).sort(function(a, b) { return (heads ? gi[a.sv.group] - gi[b.sv.group] : 0) || (key(a.sv) - key(b.sv)) || (a.i - b.i); }).map(function(x) { return x.sv; });
				srvCount.textContent = rows.length + tr(' از ') + list.length + tr(' سرور') + (hasPing ? tr(' — مرتب‌شده از کمترین پینگ') : '');
				var present = {};
				list.forEach(function(sv) { present[sv.id] = 1; });
				Object.keys(picked).forEach(function(id) { if (!present[id]) delete picked[id]; });
				updateBulkUi(rows);
				if (!rows.length) {
					srvBody.appendChild(E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': '7' }, E('em', {}, list.length ? tr('سروری با این جستجو پیدا نشد.') : tr('هنوز سروری در فهرست نیست. با دکمه «افزودن سرور» یکی بسازید.'))) ]));
					return;
				}
				var lastG = null;
				rows.forEach(function(sv) {
					if (heads && sv.group !== lastG) {
						lastG = sv.group;
						srvBody.appendChild(E('tr', { 'class': 'tr vh-grp' }, [ E('td', { 'class': 'td', 'colspan': '7' }, [ E('strong', {}, gname(sv.group)), E('span', {}, ' · ' + gcount[sv.group] + tr(' سرور')) ]) ]));
					}
					var rb = E('input', { 'type': 'radio', 'name': 'vpnhubsrv' });
					rb.checked = sv.active;
					rb.addEventListener('change', function() { if (rb.checked) useServer(sv); });
					var pc = E('td', { 'class': 'td', 'dir': 'auto', 'style': 'text-align:center', 'data-title': tr('پینگ تا سرور') }, '—');
					var tc = E('td', { 'class': 'td', 'dir': 'auto', 'style': 'text-align:center', 'data-title': tr('تست از راه سرور') }, '—');
					pingCells[sv.id] = pc;
					probeCells[sv.id] = tc;
					/* the ping to the server's address; replaced by the time through the tunnel once a real connection test tried it */
					if (REAL && (realRes[sv.id] || (realRunning && realNow === sv.id))) realCell(pc, sv);
					else { cellText(pc, pingRes[sv.id], 'no reply'); hsCell(pc, sv); }
					cellText(tc, probeRes[sv.id], 'not connected');
					var pick = null;
					if (bulk) {
						pick = E('input', { 'type': 'checkbox', 'title': tr('انتخاب برای حذف') });
						pick.checked = !!picked[sv.id];
						pick.addEventListener('change', function() {
							if (pick.checked) picked[sv.id] = 1; else delete picked[sv.id];
							updateBulkUi(rows);
						});
					}
					srvBody.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'text-align:center' }, rb),
						E('td', { 'class': 'td' }, [ E('strong', {}, (sv.label || sv.host) + ' '), (T.ports && T.account && sv.own) ? E('span', { 'style': 'opacity:.75;font-size:90%' }, tr(' (حساب جدا)')) : '' ]),
						E('td', { 'class': 'td', 'data-title': tr('نشانی') }, E('span', { 'dir': 'ltr' }, sv.ip)),
						pc,
						tc,
						T.ports ? portCell(sv) : (T.link ? E('td', { 'class': 'td', 'dir': 'ltr', 'style': 'font-size:90%' }, (sv.proto || '—') + (sv.port ? ' :' + sv.port : '')) : E('td', { 'class': 'td' }, !T.account ? '—' : (sv.own ? tr('حساب جدا') : tr('پیش‌فرض')))),
						E('td', { 'class': 'td' }, [
								E('div', { 'class': 'vh-acts', 'style': 'display:inline-flex;gap:8px;flex-wrap:nowrap;align-items:center' }, [
									pick || '',
									iconButton('edit', tr('ویرایش'), '', function() { return editServer(sv); }),
									iconButton('del', tr('حذف'), ' cbi-button-negative', function() { return delServer(sv); })
								])
						])
					]));
				});
			}

			/* --- which ports answer (WireGuard / AmneziaWG) --- */
			var portRes = {};
			var portInfo = E('div', { 'style': 'margin:6px 0' }, '');
			function showPorts(o) {
				var x = {};
				o.split(NL).forEach(function(l) {
					var i = l.indexOf('=');
					if (i < 0) return;
					var k = l.slice(0, i), v = l.slice(i + 1);
					if (k === 'ports') { var p = v.split('|'); portRes[p[0]] = { open: p[1] || '', port: p[2] || '', ms: p[3] || '' }; } else x[k] = v;
				});
				renderServers(srvList);
				portInfo.innerHTML = '';
				if (x.ports_tried) {
					portInfo.appendChild(E('span', {}, tr('درگاه‌های امتحان‌شده: درگاه خود هر سرور و ')));
					portInfo.appendChild(E('span', { 'dir': 'ltr' }, x.ports_tried.split(',').join(', ')));
					if (x.ports_now && x.ports_running === '1' && portRes[x.ports_now] && portRes[x.ports_now].open === '…') portInfo.appendChild(E('span', {}, tr(' — نوبت: ') + ((srvList.filter(function(v) { return v.id === x.ports_now; })[0] || {}).label || '')));
					if (x.ports_running === '1') portInfo.appendChild(E('span', {}, tr(' — در حال تست…')));
				}
				return x;
			}
			function pollPorts() {
				return ex(['port-status']).then(function(o) {
					var x = showPorts(o);
					if (x.ports_running === '1') return wait(3000).then(pollPorts);
					return reloadAll();
				});
			}
			function portTest(quick) {
				var n = quick ? 15 : +selCount.value;
				var go = function() {
					var ids = srvList.filter(function(sv) { return pingRes[sv.id] && pingRes[sv.id].avg; })
						.sort(function(a, b) { return +pingRes[a.id].avg - +pingRes[b.id].avg; })
						.slice(0, n).map(function(sv) { return sv.id; });
					if (!ids.length) {
						ui.addNotification(null, E('p', {}, tr('هیچ سروری به پینگ جواب نداد؛ تست درگاه انجام نشد.')), 'warning');
						return;
					}
					portRes = {};
					ids.forEach(function(h) { portRes[h] = { open: '…', port: '' }; });
					renderServers(srvList);
					return ex(['port-test', type, ids.join(',')].concat(quick ? [ 'quick' ] : [])).then(function(o) {
						if (o.indexOf('started') !== 0) {
							if (quick) { portRes = {}; renderServers(srvList); return; }
							ui.addNotification(null, E('p', {}, o.indexOf('already') === 0 ? tr('یک تست درگاه در حال اجراست. صبر کنید تمام شود.') : tr('تست شروع نشد. جواب روتر: ') + (o || tr('خالی'))), 'warning');
							return;
						}
						return wait(2500).then(pollPorts);
					});
				};
				return Object.keys(pingRes).length ? Promise.resolve(go()) : pingAll().then(go);
			}
			/* WireGuard / AmneziaWG: a ping only says the machine is on. After "ping all" the page also tries a real
			   handshake, so the ping column shows which servers actually connect, and on which port */
			function hsCell(pc, sv) {
				var r = portRes[sv.id];
				if (!T.ports || T.proto || !r || !pingRes[sv.id] || !pingRes[sv.id].avg) return;
				var note = E('span', { 'class': 'vh-note2' });
				if (r.open === '…') { note.textContent = tr('در حال بررسی اتصال…'); note.style.opacity = '.7'; }
				else if (r.open === 'active') { note.textContent = tr('همین حالا وصل است'); note.style.color = 'var(--hub-ok, #2e9e4f)'; }
				else if (r.open && r.open !== 'error') {
					/* the time measured through the tunnel on its best port replaces the plain ping */
					if (r.ms) { pc.textContent = msText(+r.ms); pc.style.color = +r.ms < 130 ? '#2e9e4f' : (+r.ms < 220 ? '#d68910' : '#c0392b'); pc.title = tr('زمان رفت‌وبرگشت از داخل تونل، روی بهترین درگاه'); }
					note.textContent = tr('وصل می‌شود'); note.style.color = 'var(--hub-ok, #2e9e4f)';
				}
				else { pc.textContent = tr('وصل نمی‌شود'); pc.style.color = 'var(--hub-bad, #c0392b)'; pc.title = tr('سرور به پینگ جواب می‌دهد ولی روی هیچ‌کدام از درگاه‌ها اتصال برقرار نشد.'); return; }
				pc.appendChild(note);
			}
			function portCell(sv) {
				var nice = function(v) { return v.indexOf(':') > 0 ? v.split(':')[0].toUpperCase() + ' ' + v.split(':')[1] : v; };
				var r = portRes[sv.id];
				var port = (T.proto && sv.proto ? sv.proto.toUpperCase() + ' ' : '') + (sv.port || '—');
				if (r && r.port && r.open !== '…') port = nice(r.port);
				var c = E('td', { 'class': 'td vh-port', 'data-title': tr('درگاه') }, [ E('bdi', { 'dir': 'ltr' }, port) ]);
				if (!r) return c;
				var t = '', col = '';
				if (r.open === '…') t = tr('در حال تست…');
				else if (r.open === 'active') { t = tr('همین حالا وصل است'); col = 'var(--hub-ok, #2e9e4f)'; }
				else if (r.open === 'error') { t = tr('تست نشد'); col = 'var(--hub-bad, #c0392b)'; }
				else if (r.open) {
					var others = r.open.split(',').filter(function(x) { return x !== r.port; }).map(nice);
					t = tr('باز') + (others.length ? tr('؛ باز هم: ') + others.join(tr('، ')) : ''); col = 'var(--hub-ok, #2e9e4f)';
				}
				else { t = tr('هیچ درگاهی جواب نداد'); col = 'var(--hub-bad, #c0392b)'; }
				var st = E('span', { 'class': 'vh-note2' }, t);
				if (col) st.style.color = col;
				c.appendChild(st);
				return c;
			}
			var inPorts = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'value': (d.ports_list || '').split(',').join(', ') });
			function savePorts() {
				var v = inPorts.value.toLowerCase().split(/[\s,]+/).filter(function(x) { return T.proto ? /^(udp|tcp):\d+$/.test(x) : /^\d+$/.test(x); }).join(',');
				return ex(['ports-set', type, v || '-']).then(function(o) {
					var m = /^saved (.*)$/.exec(o);
					if (m) inPorts.value = m[1].split(',').join(', ');
					ui.addNotification(null, E('p', {}, /^saved/.test(o) ? tr('فهرست درگاه‌ها ذخیره شد.') : tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'))), 'info');
				});
			}

			/* fromButton: the "ping all" button itself (not a test that only needs the pings first); then the servers with
			   the lowest ping are also checked for a real connection */
			function pingAll(fromButton) {
				Object.keys(pingCells).forEach(function(k) { pingCells[k].textContent = '…'; pingCells[k].style.color = ''; });
				return ex(['ping-all', type]).then(function(o) {
					pingRes = {};
					o.split(NL).forEach(function(l) {
						if (l.indexOf('ping=') !== 0) return;
						var p = l.slice(5).split('|');
						pingRes[p[0]] = { avg: p[1], loss: p[2] };
					});
					if (REAL && fromButton) realRes = {};
					renderServers(srvList);
					if (REAL && fromButton) realAuto();
					if (T.link) return loadSubs();
					/* WireGuard / AmneziaWG: check right away which of the best servers really connect */
					if (T.ports && !T.proto) portTest(true);
				});
			}

			function showProbe(o) {
				var x = { rows: [] };
				o.split(NL).forEach(function(l) {
					var i = l.indexOf('=');
					if (i < 0) return;
					var k = l.slice(0, i), v = l.slice(i + 1);
					if (k === 'probe') x.rows.push(v.split('|')); else x[k] = v;
				});
				var fmt = function(avg, loss) {
					if (!avg) return null;
					return msText(Math.round(+avg), loss);
				};
				var site = x.probe_mode === 'site';
				x.rows.forEach(function(r) {
					probeRes[r[0]] = site ? { site: true, code: r[1], sec: r[2], note: r[3] === 'no account' ? 'no account' : '' } : { avg: r[1], loss: r[2], note: r[3] === 'no account' ? 'no account' : '' };
					if (probeCells[r[0]]) cellText(probeCells[r[0]], probeRes[r[0]], 'not connected');
				});
				if (x.probe_now && x.probe_running === '1' && probeCells[x.probe_now] && probeCells[x.probe_now].textContent === '…') probeCells[x.probe_now].textContent = 'testing…';
				var dd = (x.probe_direct || '').split('|');
				probeInfo.innerHTML = '';
				if (x.probe_error) { probeInfo.appendChild(E('span', { 'style': 'color:#c0392b' }, tr('نشانی مقصد پیدا نشد. اسم یا نشانی را بررسی کنید.'))); return x; }
				if (x.probe_target && site) {
					var dc = +dd[0] || 0;
					probeInfo.appendChild(E('span', {}, tr('سایت: ')));
					probeInfo.appendChild(E('span', { 'dir': 'ltr' }, x.probe_target));
					probeInfo.appendChild(E('span', {}, tr(' — مستقیم و بدون تونل: ')));
					probeInfo.appendChild(E('strong', {}, dc >= 200 && dc < 400 ? tr('باز شد (') + dc + ')' : (dc === 0 ? tr('جواب نداد') : tr('رد شد (') + dc + ')')));
					if (x.probe_running === '1') probeInfo.appendChild(E('span', {}, tr(' — در حال تست…')));
				}
				else if (x.probe_target) {
					probeInfo.appendChild(E('span', {}, tr('مقصد: ')));
					probeInfo.appendChild(E('span', { 'dir': 'ltr' }, x.probe_target + (x.probe_ip && x.probe_ip !== x.probe_target ? ' (' + x.probe_ip + ')' : '')));
					probeInfo.appendChild(E('span', {}, tr(' — مستقیم و بدون تونل: ')));
					probeInfo.appendChild(E('strong', { 'dir': 'ltr' }, fmt(dd[0], dd[1]) || 'no reply'));
					if (x.probe_running === '1') probeInfo.appendChild(E('span', {}, tr(' — در حال تست…')));
				}
				return x;
			}

			function pollProbe() {
				return ex(['probe-status']).then(function(o) {
					var x = showProbe(o);
					if (x.probe_running === '1') return wait(3000).then(pollProbe);
					return refresh();
				});
			}

			function probeAll(siteMode) {
				var t = (siteMode ? inSite : inTarget).value.trim();
				/* a pasted address like https://www.instagram.com/explore is reduced to the name for the ping test */
				if (!siteMode) { t = t.replace(/^[a-z]+:\/\//i, '').replace(/[\/?#:].*$/, ''); inTarget.value = t; }
				if (!t) return Promise.resolve();
				var n = +selCount.value;
				var go = function() {
					/* after a real connection test only the servers that really connected are tried, best first */
					var ids = (REAL && hasReal())
						? srvList.filter(function(sv) { return realRes[sv.id] && realRes[sv.id].ms; })
							.sort(function(a, b) { return +realRes[a.id].ms - +realRes[b.id].ms; })
							.slice(0, n).map(function(sv) { return sv.id; })
						: srvList.filter(function(sv) { return pingRes[sv.id] && pingRes[sv.id].avg; })
							.sort(function(a, b) { return +pingRes[a.id].avg - +pingRes[b.id].avg; })
							.slice(0, n).map(function(sv) { return sv.id; });
					if (!ids.length) {
						ui.addNotification(null, E('p', {}, tr('هیچ سروری به پینگ جواب نداد؛ تست مقصد انجام نشد.')), 'warning');
						return;
					}
					if (!window.confirm(tr('روتر به نوبت به ') + ids.length + tr(' سروری که کمترین پینگ را دارند وصل می‌شود و از راه هر کدام تا مقصد پینگ می‌گیرد. حدود ') + Math.max(1, Math.round(ids.length * 20 / 60)) + tr(' دقیقه طول می‌کشد. در این مدت همه دستگاه‌ها روی خط مستقیم‌اند و در پایان تونل به حالت قبل برمی‌گردد. شروع شود؟'))) return;
					probeRes = {};
					renderServers(srvList);
					ids.forEach(function(h) { if (probeCells[h]) probeCells[h].textContent = '…'; });
					return ex([siteMode ? 'site-all' : 'probe-all', type, t, ids.join(',')]).then(function(o) {
						if (o.indexOf('started') !== 0) {
							ui.addNotification(null, E('p', {}, o.indexOf('already') === 0 ? tr('یک تست دیگر در حال اجراست. صبر کنید تمام شود.') : tr('تست شروع نشد. اسم یا نشانی مقصد را بررسی کنید.')), 'warning');
							return;
						}
						return wait(2500).then(pollProbe);
					});
				};
				return (Object.keys(pingRes).length || (REAL && hasReal())) ? Promise.resolve(go()) : pingAll().then(go);
			}

			function addBulk() {
				var text = taAdd.value.split(NL).map(function(x) { return x.trim(); }).filter(function(x) { return x; }).join(NL);
				if (!text) return Promise.resolve();
				return busy(tr('در حال افزودن سرورها'), function() {
					return fs.write(INFILE, text + NL, 384).then(function() { return ex(['bulk', type]); }).then(function(o) {
						if (T.link) {
							var na = (/added=(\d+)/.exec(o) || [])[1], nb = (/badn=(\d+)/.exec(o) || [])[1];
							return reloadAll().then(function() {
								if (na === undefined) return tr('اضافه نشد. جواب روتر: ') + (o || tr('خالی'));
								taAdd.value = '';
								return na + tr(' سرور تازه اضافه شد.') + (+nb ? ' ' + nb + tr(' خط خوانده نشد (لینک ناقص یا نوعی که پشتیبانی نمی‌شود).') : '');
							});
						}
						var badList = [];
						o.split(NL).forEach(function(l) { if (l.indexOf('bad=') === 0) badList.push(l.slice(4)); });
						return reloadAll().then(function() {
							taAdd.value = badList.join(NL);
							return badList.length ? (tr('این‌ها اضافه نشدند، چون نشانی واقعی‌شان پیدا نشد: ') + badList.join(tr(' ، '))) : tr('اضافه شد.');
						});
					});
				});
			}

			/* --- default account --- */
			var inUser = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'autocomplete': 'off', 'value': d.cred_user || '' });
			var inPass = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred === '1' ? tr('(ذخیره شده)') : '' });
			function saveCred() {
				var u = inUser.value.trim(), p = inPass.value;
				if (!u || !p) {
					ui.addNotification(null, E('p', {}, tr('نام کاربری و رمز هر دو باید پر باشند.')), 'warning');
					return Promise.resolve();
				}
				if (bad(u + p)) {
					ui.addNotification(null, E('p', {}, tr('علامت نقل‌قول دوتایی و بک‌اسلش در نام کاربری و رمز پشتیبانی نمی‌شود.')), 'warning');
					return Promise.resolve();
				}
				return busy(tr('در حال ذخیره حساب'), function() {
					return fs.write(INFILE, u + NL + p + NL, 384)
						.then(function() { return ex(['account', type]); })
						.then(function(o) {
							inPass.value = '';
							if (/credentials saved/.test(o)) {
								inPass.setAttribute('placeholder', tr('(ذخیره شده)'));
								return wait(/starting/.test(o) ? 16000 : 500).then(refresh).then(function() {
									return tr('حساب ذخیره شد.') + (/starting/.test(o) ? tr(' تونل با حساب تازه دوباره وصل می‌شود؛ وضعیت را بالای صفحه ببینید.') : '');
								});
							}
							return tr('حساب ذخیره نشد. جواب روتر: ') + (o || tr('خالی'));
						});
				});
			}

			/* --- personal WireGuard key (shared by WireGuard and AmneziaWG) --- */
			var wgKey = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred === '1' ? tr('(ذخیره شده)') : '' });
			var wgAddr = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'off', 'placeholder': '10.0.0.2/32', 'value': T.account ? '' : (d.cred_user || '') });
			var wgPsk = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred_psk === '1' ? tr('(ذخیره شده)') : '' });
			function saveWgKey() {
				var k = wgKey.value.trim(), a = wgAddr.value.trim(), p = wgPsk.value.trim();
				if (!a || (!k && d.cred !== '1')) {
					ui.addNotification(null, E('p', {}, tr('کلید خصوصی و نشانی تونل هر دو لازم‌اند.')), 'warning');
					return Promise.resolve();
				}
				return busy(tr('در حال ذخیره کلید'), function() {
					return fs.write(INFILE, k + NL + a + NL + p + NL, 384)
						.then(function() { return ex(['account', type]); })
						.then(function(o) {
							if (/credentials saved/.test(o)) {
								wgKey.value = ''; wgPsk.value = ''; d.cred = '1';
								wgKey.setAttribute('placeholder', tr('(ذخیره شده)'));
								return wait(/starting/.test(o) ? 14000 : 500).then(refresh).then(function() { return tr('کلید ذخیره شد.'); });
							}
							if (/bad key/.test(o)) return tr('کلید درست نیست. کلید وایرگارد ۴۴ نویسه است و با علامت = تمام می‌شود.');
							if (/bad address/.test(o)) return tr('نشانی تونل درست نیست. نمونه: 10.0.0.2/32');
							return tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'));
						});
				});
			}

			/* --- subscription addresses (V2Ray page) --- */
			var taSubs = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:38em;height:5em;direction:ltr;text-align:left;font-family:monospace;font-size:90%', 'placeholder': 'https://example.com/sub/...' });
			var subInfo = E('div', { 'style': 'opacity:.75;font-size:90%;margin-top:6px' }, '');
			function loadSubs() {
				return ex(['sub-get']).then(function(o) {
					var urls = [], infos = [], last = '', cnt = '0';
					o.split(NL).forEach(function(l) {
						if (l.indexOf('sub=') === 0) urls.push(l.slice(4));
						else if (l.indexOf('subinfo=') === 0) infos.push(l.slice(8));
						else if (l.indexOf('sub_last=') === 0) last = l.slice(9);
						else if (l.indexOf('sub_count=') === 0) cnt = l.slice(10);
					});
					taSubs.value = urls.join(NL);
					subInfo.innerHTML = '';
					if (!urls.length) return;
					var gb = function(n) { return (n / 1073741824).toFixed(n >= 10737418240 ? 1 : 2) + tr(' گیگابایت'); };
					infos.forEach(function(v, i) {
						if (!v) return;
						var q = v.split('|'), used = (+q[0] || 0) + (+q[1] || 0), total = +q[2] || 0, exp = +q[3] || 0, parts = [];
						parts.push(tr('مصرف: ') + gb(used) + (total ? tr(' از ') + gb(total) + tr(' (مانده: ') + gb(Math.max(0, total - used)) + ')' : tr(' (بدون سقف حجم)')));
						if (exp) {
							var days = Math.ceil((exp * 1000 - Date.now()) / 86400000);
							parts.push(days > 0 ? (days + tr(' روز تا پایان اشتراک (') + new Date(exp * 1000).toLocaleDateString(LOCALE) + ')') : tr('اشتراک تمام شده است'));
						} else parts.push(tr('بدون تاریخ پایان'));
						var over = (total && used >= total) || (exp && exp * 1000 < Date.now());
						subInfo.appendChild(E('div', { 'style': 'margin:4px 0;font-size:110%' + (over ? ';color:#c00' : '') }, [
							E('strong', {}, (urls.length > 1 ? tr('اشتراک ') + (i + 1) : tr('اشتراک')) + (q[4] ? ' «' + q[4] + '»' : '') + ' — '), parts.join(' — ')
						]));
					});
					subInfo.appendChild(E('div', {}, cnt + tr(' سرور از اشتراک‌ها در فهرست است.') + (+last ? tr(' آخرین به‌روزرسانی: ') + new Date(+last * 1000).toLocaleString(LOCALE) + tr(' (حجم و تاریخ هم همان موقع خوانده شده)') : '')));
				});
			}
			function saveSubs(fetchNow) {
				var text = taSubs.value.split(NL).map(function(x) { return x.trim(); }).filter(function(x) { return x; }).join(NL);
				return busy(fetchNow ? tr('در حال گرفتن سرورها از اشتراک') : tr('در حال ذخیره'), function() {
					return fs.write(INFILE, text + NL, 384).then(function() { return ex(['sub-set']); }).then(function(o) {
						if (!/^saved /.test(o)) return tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'));
						var kept = +o.slice(6);
						if (text && !kept) return tr('نشانی اشتراک درست نیست. باید با http://‎ یا https://‎ شروع شود.');
						if (!fetchNow) return loadSubs().then(function() { return tr('ذخیره شد.'); });
						return ex(['sub-update']).then(function() {
							var tries = 0;
							var again = function() {
								return wait(3000).then(function() { return ex(['sub-status']); }).then(function(st) {
									tries++;
									if ((st === 'running' || st === '') && tries < 200) return again();
									return st;
								});
							};
							return again();
						}).then(function(st) {
							var m = /added=(\d+) removed=(\d+) failed=(\d+)/.exec(st);
							return reloadAll().then(loadSubs).then(function() {
								if (!m) return tr('به‌روزرسانی تمام نشد. جواب روتر: ') + (st || tr('خالی'));
								return m[1] + tr(' سرور تازه اضافه شد و ') + m[2] + tr(' سرور قدیمی پاک شد.') + (+m[3] ? ' ' + m[3] + tr(' نشانی اشتراک جواب نداد یا چیزی در آن نبود.') : '');
							});
						});
					});
				});
			}
			if (T.link) loadSubs();

			function showLog() {
				return ex(['log']).then(function(o) {
					ui.showModal(tr('آخرین پیام‌های تونل'), [
						E('pre', { 'dir': 'ltr', 'style': 'text-align:left;max-height:24em;overflow:auto;font-size:85%;white-space:pre-wrap' }, o || '(empty)'),
						E('div', { 'style': 'margin-top:10px' }, [ E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, tr('بستن')) ])
					]);
				});
			}

			paint(d);
			renderServers(d.prof);
			if (REAL) loadReal();
			if (hubPoll) poll.remove(hubPoll);
			hubPoll = refresh;
			poll.add(refresh, 5);

			var sec = function(title, children) {
				return E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [ E('h3', {}, title) ].concat(children));
			};
			var hint = function(t) { return E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, t); };

			var serverSection = [
				hint(REAL
					? tr('با زدن دایره کنار هر سرور، تونل به همان سرور وصل می‌شود. «تست پینگ تا همه سرورها» پینگ روتر تا هر سرور را نشان می‌دهد؛ بعد روتر خودش به ۱۰ سروری که کمترین پینگ را دارند با حساب ذخیره‌شده واقعاً وصل می‌شود: برای آن‌ها پینگ از داخل تونل نوشته می‌شود یا «وصل نمی‌شود». ') + (T.link ? tr('برای V2Ray این بررسی سبک است و تونل فعلی خانه را قطع نمی‌کند. ') : tr('این بررسی چند دقیقه طول می‌کشد و در این مدت دستگاه‌ها روی خط مستقیم‌اند. ')) + tr('ستون «تست از راه سرور» نتیجه آخرین تستی است که از دو دکمه پایین می‌گیرید: پینگ تا یک مقصد (مثلاً سرور بازی) یا باز شدن یک سایت.')
					: tr('با زدن دایره کنار هر سرور، تونل به همان سرور وصل می‌شود. «پینگ تا سرور» از خود روتر تا سرور تونل است. ستون «تست از راه سرور» نتیجه آخرین تستی است که از دو دکمه پایین می‌گیرید: پینگ تا یک مقصد (مثلاً سرور بازی) یا باز شدن یک سایت.')),
				E('div', { 'style': 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0' }, [
					E('button', { 'class': 'cbi-button cbi-button-add', 'click': function() { return editServer(null); } }, tr('افزودن سرور')),
					inFilter, srvCount,
					grpBar,
					btnBulk, btnGo
				]),
				E('div', { 'class': 'vh-list', 'style': 'overflow:auto;max-height:28em;border:1px solid rgba(128,128,128,.25);border-radius:8px' }, [
					E('table', { 'class': 'table vh-servers' }, [
						E('thead', {}, [ E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th', 'style': 'text-align:center' }, tr('انتخاب')),
							E('th', { 'class': 'th' }, tr('سرور')),
							E('th', { 'class': 'th' }, tr('نشانی')),
							E('th', { 'class': 'th', 'style': 'text-align:center' }, tr('پینگ تا سرور')),
							E('th', { 'class': 'th', 'style': 'text-align:center' }, tr('تست از راه سرور')),
							E('th', { 'class': 'th' }, T.ports ? tr('درگاه') : (T.link ? tr('نوع') : tr('حساب'))),
							thAct
						]) ]),
						srvBody
					])
				]),
				E('div', { 'style': 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return pingAll(true); } }, tr('تست پینگ تا همه سرورها')),
					realInfo
				]),
				E('datalist', { 'id': 'vpnhub-targets' }, [
					E('option', { 'value': '1.1.1.1' }, 'Cloudflare'),
					E('option', { 'value': 'instagram.com' }, 'Instagram'),
					E('option', { 'value': 'telegram.org' }, 'Telegram'),
					E('option', { 'value': 'google.com' }, 'Google'),
					E('option', { 'value': 'youtube.com' }, 'YouTube'),
					E('option', { 'value': '155.133.226.68' }, 'CS2 Frankfurt'),
					E('option', { 'value': '155.133.252.37' }, 'CS2 Stockholm')
				]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
					E('label', {}, [ tr('مقصد دلخواه '), inTarget ]),
					E('label', {}, [ tr('تعداد سرور '), selCount ]),
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return probeAll(); } }, tr('تست پینگ تا مقصد از راه بهترین سرورها'))
				]),
				E('datalist', { 'id': 'vpnhub-sites' }, [
					E('option', { 'value': 'https://gemini.google.com/app' }, 'Gemini'),
					E('option', { 'value': 'https://chatgpt.com/' }, 'ChatGPT'),
					E('option', { 'value': 'https://claude.ai/' }, 'Claude'),
					E('option', { 'value': 'https://www.netflix.com/' }, 'Netflix'),
					E('option', { 'value': 'https://open.spotify.com/' }, 'Spotify')
				]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
					E('label', {}, [ tr('نشانی سایت '), inSite ]),
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return probeAll(true); } }, tr('تست باز شدن سایت از راه بهترین سرورها'))
				]),
				hint(tr('بعضی سایت‌ها بعضی سرورها را راه نمی‌دهند (خطای 403)، حتی وقتی کشورش مجاز است. این تست به هر سرور وصل می‌شود، همان سایت را باز می‌کند و در ستون «تست از راه سرور» می‌نویسد باز شد یا رد شد. «باز شد» یعنی خود سایت جواب داد؛ ورود به حساب را امتحان نمی‌کند.')),
				hint(tr('مقصد می‌تواند نشانی عددی (مثلاً سرور بازی) یا اسم سایت باشد، مثل instagram.com. اگر مقصد به پینگ جواب ندهد (خیلی از سایت‌ها، و همیشه از راه V2Ray)، زمان دست‌دهی امن (TLS) با همان مقصد اندازه گرفته می‌شود که تقریباً همان پینگ است. تست فقط روی سرورهایی انجام می‌شود که کمترین «پینگ تا سرور» را دارند، به تعدادی که انتخاب می‌کنید.')),
				probeInfo
			];
			if (T.ports) {
				serverSection.push(
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 4px 0' }, [
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return portTest(); } }, tr('تست درگاه‌ها روی بهترین سرورها'))
					]),
					hint(T.proto
						? tr('«پینگ تا سرور» فقط می‌گوید سرور روشن است؛ نمی‌گوید روی کدام پروتکل و درگاه وصل می‌شود. این تست روی سرورهایی که کمترین پینگ را دارند (به همان «تعداد سرور» بالا) با هر درگاه UDP و TCP فهرست زیر واقعاً دست می‌دهد و در ستون «درگاه» می‌نویسد کدام‌ها باز است. هر سرور حدود ۲۰ ثانیه طول می‌کشد و تونلِ در حال کار قطع نمی‌شود. اگر درگاه فعلی یک سرور بسته باشد، خودکار روی اولین درگاه باز گذاشته می‌شود. برای انتخاب دستی، «ویرایش» سرور را بزنید و پروتکل و درگاه را مشخص کنید.')
						: tr('«پینگ تا سرور» فقط می‌گوید سرور روشن است؛ نمی‌گوید روی کدام درگاه وصل می‌شود. این تست روی سرورهایی که کمترین پینگ را دارند (به همان «تعداد سرور» بالا) واقعاً با هر درگاه دست می‌دهد و در ستون «درگاه» می‌نویسد کدام‌ها باز است. تونلِ در حال کار قطع نمی‌شود. اگر درگاه فعلی یک سرور بسته باشد، خودکار روی اولین درگاه باز گذاشته می‌شود. هنگام وصل شدن هم اگر درگاه سرور جواب ندهد، روتر خودش بقیه درگاه‌ها را امتحان می‌کند و درگاهی را که جواب داد به خاطر می‌سپارد. برای انتخاب دستی، «ویرایش» سرور را بزنید و درگاه را بنویسید.')),
					portInfo,
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0' }, [
						E('label', {}, [ T.proto ? tr('درگاه‌هایی که امتحان می‌شوند (مثل udp:443) ') : tr('درگاه‌های جایگزین که امتحان می‌شوند '), inPorts ]),
						E('button', { 'class': 'cbi-button', 'click': savePorts }, tr('ذخیره درگاه‌ها'))
					])
				);
			}
			if (T.bulk) {
				serverSection.push(
					E('strong', {}, T.link ? tr('افزودن چند لینک با هم') : tr('افزودن چند سرور با هم')),
					hint(T.bulkHint || tr('هر خط یک سرور. بعد از نشانی سرور می‌توانید یک فاصله بگذارید و اسم دلخواهی برایش بنویسید. این سرورها از حساب پیش‌فرض استفاده می‌کنند.')),
					taAdd,
					E('div', { 'style': 'margin-top:8px' }, [ E('button', { 'class': 'cbi-button cbi-button-add', 'click': addBulk }, tr('افزودن به فهرست')) ])
				);
			}


			var page = [
				E('h2', {}, T.title),
				E('div', { 'class': 'cbi-map-descr' }, tr('هر بار فقط یک تونل روشن است: با روشن کردن این تونل، تونل‌های دیگر خاموش می‌شوند. اگر تونل قطع شود، همه دستگاه‌ها خودکار به خط مستقیم برمی‌گردند و روتر خودش دوباره برای وصل شدن تلاش می‌کند.')),
				warnMissing,

				sec(tr('وضعیت'), [
					info,
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
						E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
							return busy(tr('در حال وصل شدن'), function() {
								return ex(['start-bg', type]).then(function(o) {
									if (o.indexOf('starting') !== 0) return tr('اول یک سرور از فهرست پایین انتخاب کنید.');
									return wait(16000).then(refresh).then(function() { return ''; });
								});
							});
						} }, tr('روشن کردن')),
						E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
							return busy(tr('در حال خاموش کردن'), function() { return ex(['off']).then(function() { return wait(1500); }).then(refresh).then(function() { return ''; }); });
						} }, tr('خاموش کردن')),
						E('button', { 'class': 'cbi-button', 'click': function() { return refresh(); } }, tr('تازه‌سازی')),
						E('button', { 'class': 'cbi-button', 'click': function() { return showLog(); } }, tr('پیام‌های تونل'))
					]),
					E('label', { 'style': 'display:block;margin:12px 0 2px 0' }, [ cbFail, tr(' جایگزینی خودکار: اگر سرور فعلی حدود ۲ دقیقه وصل نشد، روتر خودش بهترین سرورِ در دسترس را پیدا کند و به آن وصل شود') ]),
					failInfo
				]),

				sec(tr('سرورها'), serverSection)
			];

			if (T.link) {
				page.push(sec(tr('لینک اشتراک (Subscription)'), [
					hint(tr('اگر سرویس‌دهنده به شما یک نشانی اشتراک داده، اینجا بنویسید (هر خط یک نشانی). روتر سرورهای آن را به فهرست بالا می‌آورد و روزی یک بار خودش تازه‌شان می‌کند: سرورهای تازه اضافه و سرورهای حذف‌شده پاک می‌شوند. سروری که الان به آن وصل هستید پاک نمی‌شود.')),
					taSubs,
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px' }, [
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return saveSubs(true); } }, tr('ذخیره و گرفتن سرورها')),
						E('button', { 'class': 'cbi-button', 'click': function() { return saveSubs(false); } }, tr('فقط ذخیره'))
					]),
					subInfo
				]));
			}

			if (T.wgkey) {
				page.push(sec(tr('کلید شخصی (مشترک بین WireGuard و AmneziaWG)'), [
					hint(tr('اگر متن کانفیگ یک سرور کلید خصوصی و نشانی تونل نداشته باشد (مثل سرورهایی که از فایل پشتیبان آمده‌اند)، این کلید به کار می‌رود. این سه مقدار در فایل کانفیگی که سرویس‌دهنده به شما می‌دهد هست: PrivateKey، Address و PresharedKey. کلیدهای ذخیره‌شده اینجا نمایش داده نمی‌شوند.')),
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
						E('label', {}, [ tr('کلید خصوصی (PrivateKey) '), wgKey ]),
						E('label', {}, [ tr('نشانی تونل (Address) '), wgAddr ]),
						E('label', {}, [ tr('کلید مشترک (PresharedKey، اختیاری) '), wgPsk ]),
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveWgKey }, tr('ذخیره کلید'))
					])
				]));
			}

			if (T.account) {
				page.push(sec(tr('حساب پیش‌فرض'), [
					hint(T.accountHint + tr(' رمز ذخیره‌شده اینجا نمایش داده نمی‌شود.')),
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
						E('label', {}, [ tr('نام کاربری '), inUser ]),
						E('label', {}, [ tr('رمز '), inPass ]),
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveCred }, tr('ذخیره حساب'))
					])
				]));
			}

			page.push(E('div', { 'style': 'opacity:.75;font-size:90%;margin-top:18px' }, [
				tr('مسیردهی (چه چیزی از تونل برود و چه چیزی مستقیم)، چراغ روتر و پشتیبان‌گیری برای همه تونل‌ها یکی است و در صفحه '),
				E('a', { 'href': L.url('admin/vpnhub') + '#settings' }, 'Settings'), tr(' است.')
			]));

			return E('div', { 'class': 'cbi-map', 'dir': DIR, 'style': 'text-align:' + ALIGN }, page);
		},

		handleSave: null,
		handleSaveApply: null,
		handleReset: null
	});
}

/* --- "this site through that server": extra V2Ray tunnels next to the main one (settings page) --- */
function sitesSection(out) {
	var MAX = 5;
	var hint = function(t) { return E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, t); };
	var box = E('div', {});
	var info = E('div', { 'style': 'margin:8px 0' }, '');
	var servers = [], rows = [];

	function read(o) {
		var x = { site: [], v2: [], msg: [] };
		(o || '').split(NL).forEach(function(l) {
			var i = l.indexOf('=');
			if (i < 0) return;
			var k = l.slice(0, i), v = l.slice(i + 1);
			if (k === 'site') { var q = v.split('|'); x.site.push({ id: q[1], label: q[2], up: q[3] === '1', ents: (q[4] || '').split(',').join(NL) }); }
			else if (k === 'v2') { var j = v.indexOf('|'); x.v2.push({ id: v.slice(0, j), label: v.slice(j + 1) }); }
			else if (k === 'sites_msg') x.msg.push(v);
			else x[k] = v;
		});
		return x;
	}

	function addRow(r) {
		if (rows.length >= MAX) return;
		var sel = E('select', { 'class': 'cbi-input-select', 'style': 'max-width:22em' }, servers.map(function(sv) {
			var o = E('option', { 'value': sv.id }, sv.label || sv.id);
			if (r && r.id === sv.id) o.setAttribute('selected', 'selected');
			return o;
		}));
		var ta = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:26em;height:4.5em;direction:ltr;text-align:left', 'placeholder': 'example.com' });
		ta.value = r ? r.ents : '';
		var st = E('span', { 'style': 'font-size:90%' }, '');
		var row = { sel: sel, ta: ta, st: st };
		row.el = E('div', { 'style': 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin:8px 0;padding:8px;border:1px solid rgba(128,128,128,.25);border-radius:8px' }, [
			E('label', {}, [ E('div', {}, tr('از راه این سرور')), sel, E('div', {}, st) ]),
			E('label', { 'style': 'flex:1;min-width:14em' }, [ E('div', {}, tr('این سایت‌ها (هر خط یکی)')), ta ]),
			E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() { rows.splice(rows.indexOf(row), 1); box.removeChild(row.el); } }, tr('حذف'))
		]);
		rows.push(row);
		box.appendChild(row.el);
	}

	function paint(x) {
		servers = x.v2;
		box.innerHTML = ''; rows = [];
		x.site.forEach(function(r) { addRow(r); });
		rows.forEach(function(row, i) {
			var r = x.site[i];
			row.st.textContent = x.sites_running === '1' ? tr('در حال وصل شدن…') : (r.up ? tr('وصل است') : tr('وصل نیست'));
			row.st.style.color = x.sites_running === '1' ? '' : (r.up ? '#080' : '#c00');
		});
		var bad = x.msg.filter(function(m) { return m.indexOf(': connected') < 0; });
		info.textContent = bad.length ? (tr('پیام روتر: ') + bad.join(tr(' ؛ '))) : '';
	}

	function reload() { return ex(['sites-get']).then(function(o) { paint(read(o)); }); }

	function save() {
		var lines = [];
		for (var i = 0; i < rows.length; i++) {
			var ents = csv(rows[i].ta.value);
			if (ents === '-' || !ents) continue;
			if (!rows[i].sel.value) continue;
			lines.push(rows[i].sel.value + ' ' + ents);
		}
		return busyModal(tr('در حال ذخیره و وصل شدن به سرورهای قانون‌ها'), function() {
			return fs.write(INFILE, lines.join(NL) + NL, 384).then(function() { return ex(['sites-set']); }).then(function(o) {
				if (!/^saved /.test(o)) return tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'));
				var tries = 0;
				var again = function() {
					return wait(3000).then(function() { return ex(['sites-get']); }).then(function(g) {
						tries++;
						var x = read(g);
						if (x.sites_running === '1' && tries < 30) return again();
						paint(x);
						if (!x.site.length) return tr('ذخیره شد. قانونی فعال نیست.');
						var down = x.site.filter(function(r) { return !r.up; }).length;
						return down ? (tr('ذخیره شد، ولی ') + down + tr(' قانون وصل نشد. سرور دیگری برایش انتخاب کنید.')) : tr('ذخیره شد و همه قانون‌ها وصل‌اند.');
					});
				};
				return again();
			});
		});
	}

	var x0 = read(out);
	var body;
	if (x0.sb !== '1') {
		body = [ E('em', {}, tr('این بخش به برنامه sing-box نیاز دارد که روی این روتر نصب نیست.')) ];
	} else if (!x0.v2.length) {
		body = [ E('em', {}, tr('اول در صفحه V2Ray دست‌کم یک سرور اضافه کنید.')) ];
	} else {
		paint(x0);
		body = [
			box,
			E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
				E('button', { 'class': 'cbi-button cbi-button-add', 'click': function() { if (rows.length >= MAX) { window.alert(tr('حداکثر ') + MAX + tr(' قانون.')); return; } addRow(null); } }, tr('افزودن قانون')),
				E('button', { 'class': 'cbi-button cbi-button-save', 'click': save }, tr('ذخیره و اجرا')),
				E('button', { 'class': 'cbi-button', 'click': function() { return reload(); } }, tr('تازه‌سازی وضعیت'))
			]),
			info
		];
	}
	return [ E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [
		E('h3', {}, tr('هر سایت از یک سرور جدا')),
		hint(tr('اگر می‌خواهید چند سایت مشخص از سرور دیگری بروند (مثلاً یک سایت از آلمان و بقیه از ترکیه)، اینجا قانون بسازید. هر قانون یک تونل جدا کنار تونل اصلی روشن نگه می‌دارد و حتی وقتی تونل اصلی خاموش است کار می‌کند. قانون‌ها بر همه تنظیم‌های مسیردهی بالا مقدم‌اند. سرورِ قانون فقط از فهرست صفحه V2Ray انتخاب می‌شود. نشانی سایت را با https یا بدون آن بنویسید، هر دو قبول می‌شود؛ زیردامنه‌ها هم حساب می‌شوند. حداکثر ۵ قانون.'))
	].concat(body)) ];
}

/* --- which panel: the new dashboard look or OpenWrt's own (settings page) --- */
function lookSection(out) {
	var isHub = /look=hub/.test(out || ''), has = /hub_installed=1/.test(out || '');
	if (!has) return [];
	function go(which) {
		return busyModal(tr('در حال تغییر ظاهر پنل'), function() {
			return ex(['look', which]).then(function(o) {
				if (!/^saved/.test(o)) return tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی'));
				window.setTimeout(function() { location.href = L.url(which === 'hub' ? 'admin/home' : 'admin/status/overview'); }, 600);
				return '';
			});
		});
	}
	return [ E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [
		E('h3', {}, tr('ظاهر پنل')),
		E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 10px 0' }, tr('ظاهر تازه یک داشبورد است: صفحه خانه، نقشه و منوی کناری. اگر پنل اصلی OpenWrt را ترجیح می‌دهید، همین‌جا عوضش کنید. هیچ تنظیمی از روتر تغییر نمی‌کند، فقط ظاهر عوض می‌شود و هر وقت بخواهید از همین صفحه برمی‌گردد.')),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
			E('button', { 'class': 'cbi-button' + (isHub ? ' cbi-button-action important' : ''), 'click': function() { return go('hub'); } }, tr('ظاهر تازه (داشبورد)')),
			E('button', { 'class': 'cbi-button' + (isHub ? '' : ' cbi-button-action important'), 'click': function() { return go('classic'); } }, tr('پنل اصلی OpenWrt')),
			E('span', { 'style': 'opacity:.75' }, tr('الان: ') + (isHub ? tr('ظاهر تازه (داشبورد)') : tr('پنل اصلی OpenWrt')))
		])
	]) ];
}

function makeSettings() {
	return view.extend({
		load: function() {
			return Promise.all([ ex(['led-get']), ex(['settings-get']), ex(['sites-get']), ex(['look']) ]);
		},

		render: function(res) {
			var out = res[0];
			var shared = sharedSections(parse(res[1]));
			var x = { leds: [] };
			(out || '').split(NL).forEach(function(l) {
				var i = l.indexOf('=');
				if (i < 0) return;
				var k = l.slice(0, i), v = l.slice(i + 1).trim();
				if (k === 'led') x.leds.push(v); else x[k] = v;
			});
			var guess = (x.led_guess || '').split('|');
			var mode = x.led_mode || 'off';

			var opt = function(val, text, cur) {
				var o = E('option', { 'value': val }, text);
				if (val === cur) o.setAttribute('selected', 'selected');
				return o;
			};
			var ledSel = function(cur) {
				return E('select', { 'class': 'cbi-input-select', 'dir': 'ltr' }, [ opt('', '—', cur) ].concat(x.leds.map(function(n) { return opt(n, n, cur); })));
			};
			var selMode = E('select', { 'class': 'cbi-input-select' }, [
				opt('off', tr('خاموش (چراغ دست خود روتر بماند)'), mode),
				opt('rgb', tr('چراغ سه‌رنگ (قرمز، سبز، آبی)'), mode),
				opt('single', tr('یک چراغ ساده'), mode)
			]);
			var sR = ledSel(x.led_r || guess[0] || ''), sG = ledSel(x.led_g || guess[1] || ''), sB = ledSel(x.led_b || guess[2] || '');
			var sOne = ledSel(x.led_one || '');
			var li = function(a, b) { return E('li', {}, [ E('strong', {}, a), ' — ' + b ]); };
			var boxRgb = E('div', {}, [
				E('div', { 'style': 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:8px 0' }, [
					E('label', {}, [ tr('چراغ قرمز '), sR ]), E('label', {}, [ tr('چراغ سبز '), sG ]), E('label', {}, [ tr('چراغ آبی '), sB ])
				]),
				E('ul', { 'style': 'margin:6px 18px' }, [
					li(tr('قرمز ثابت'), tr('تونل وصل است و خروجی در قاره آمریکاست')),
					li(tr('آبی ثابت'), tr('تونل وصل است و خروجی جای دیگری است (اروپا، آسیا و …)')),
					li(tr('سفید ثابت'), tr('اینترنت هست ولی مستقیم (بدون تونل)')),
					li(tr('سبز چشمک‌زن'), tr('از مودم اینترنت نمی‌آید')),
					li(tr('زرد چشمک‌زن'), tr('نیاز به سر زدن به پنل: تونل باید وصل باشد ولی ۳ دقیقه است وصل نشده، یا اسم سایت‌ها پیدا نمی‌شود'))
				])
			]);
			var boxOne = E('div', {}, [
				E('div', { 'style': 'margin:8px 0' }, [ E('label', {}, [ tr('کدام چراغ '), sOne ]) ]),
				E('ul', { 'style': 'margin:6px 18px' }, [
					li(tr('روشن ثابت'), tr('تونل وصل است')),
					li(tr('خاموش'), tr('اینترنت مستقیم است (بدون تونل)')),
					li(tr('چشمک تند'), tr('از مودم اینترنت نمی‌آید')),
					li(tr('چشمک کند'), tr('نیاز به سر زدن به پنل'))
				])
			]);
			function sync() {
				boxRgb.style.display = selMode.value === 'rgb' ? '' : 'none';
				boxOne.style.display = selMode.value === 'single' ? '' : 'none';
			}
			selMode.addEventListener('change', sync);
			sync();

			function note(t, kind) { ui.addNotification(null, E('p', {}, t), kind || 'info'); }
			function save() {
				var m = selMode.value;
				if (m === 'rgb' && (!sR.value || !sG.value || !sB.value)) { note(tr('هر سه چراغ قرمز، سبز و آبی را انتخاب کنید.'), 'warning'); return Promise.resolve(); }
				if (m === 'single' && !sOne.value) { note(tr('یک چراغ را انتخاب کنید.'), 'warning'); return Promise.resolve(); }
				return ex(['led-set', m, sR.value || '-', sG.value || '-', sB.value || '-', sOne.value || '-']).then(function(o) {
					note(/^saved/.test(o) ? (m === 'off' ? tr('ذخیره شد. چراغ به کنترل خود روتر برگشت.') : tr('ذخیره شد. چراغ تا چند ثانیه دیگر وضعیت فعلی را نشان می‌دهد.')) : tr('ذخیره نشد. جواب روتر: ') + (o || tr('خالی')));
				});
			}
			function test() {
				return ex(['led-test']).then(function(o) {
					note(/^started/.test(o) ? tr('حدود ۱۵ ثانیه به چراغ نگاه کنید: هر حالت ۳ ثانیه نشان داده می‌شود (مستقیم، تونل، تونل آمریکا، بدون اینترنت، نیاز به سر زدن) و بعد به حالت عادی برمی‌گردد.') : tr('اول چراغ را روشن و ذخیره کنید.'));
				});
			}

			var body = x.leds.length ? [
				E('div', { 'style': 'margin:6px 0' }, [ E('label', {}, [ tr('حالت '), selMode ]) ]),
				boxRgb, boxOne,
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
					E('button', { 'class': 'cbi-button cbi-button-save', 'click': save }, tr('ذخیره')),
					E('button', { 'class': 'cbi-button', 'click': test }, tr('آزمایش چراغ'))
				])
			] : [ E('em', {}, tr('این روتر چراغ قابل کنترلی ندارد.')) ];

			return E('div', { 'class': 'cbi-map', 'dir': DIR, 'style': 'text-align:' + ALIGN }, [
				E('h2', {}, tr('تنظیمات VPNHUB')),
				E('div', { 'class': 'cbi-map-descr' }, tr('این تنظیم‌ها برای همه تونل‌ها یکی است.'))
			].concat(shared.routing, sitesSection(res[2]), [
				E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [
					E('h3', {}, tr('چراغ وضعیت')),
					E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, tr('اختیاری است. اگر روشنش کنید، چراغ روتر نشان می‌دهد اینترنت خانه الان از تونل می‌رود، مستقیم است یا قطع شده. اسم چراغ‌ها در هر روتر فرق دارد؛ با «آزمایش چراغ» مطمئن شوید درست انتخاب کرده‌اید. با انتخاب «خاموش» چراغ به حالت قبلی خودش برمی‌گردد.'))
				].concat(body))
			], shared.backup, lookSection(res[3])));
		},

		handleSave: null,
		handleSaveApply: null,
		handleReset: null
	});
}

return baseclass.extend({
	view: function(type) {
		return makeView(type);
	},
	settings: function() {
		return makeSettings();
	},
	/* for the one-page hub: the list of tunnel types, and a type's page as a ready node */
	types: function() {
		return ['v2ray'].concat(Object.keys(TYPES).filter(function(k) { return k !== 'v2ray'; })).map(function(k) { return { id: k, name: TYPES[k].name }; });
	},
	parse: parse,
	iconButton: iconButton,
	tab: function(id) {
		var V = (id === 'settings') ? makeSettings() : makeView(id);
		var v = Object.create(V.prototype);
		if (id === 'settings' && hubPoll) { poll.remove(hubPoll); hubPoll = null; }
		return Promise.resolve(v.load()).then(function(d) { return { node: v.render(d), data: d }; });
	}
});
