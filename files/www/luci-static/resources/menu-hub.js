'use strict';
'require baseclass';
'require ui';
'require fs';

/* Hub theme: side menu with collapsible groups, plus the usual tab row inside a page. */

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		let node = tree, url = '';
		const modes = ui.menu.getChildren(tree);

		modes.forEach((child, index) => {
			const isActive = L.env.requestpath.length ? child.name === L.env.requestpath[0] : index === 0;
			if (isActive) this.renderSideMenu(child, child.name);
		});

		if (L.env.dispatchpath.length >= 3) {
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}
			if (node) this.renderTabMenu(node, url);
		}

		const side = document.querySelector('#hub-side'), shade = document.querySelector('#hub-shade'), burger = document.querySelector('#hub-burger');
		const close = () => document.body.classList.remove('hub-menu-open');
		if (burger) burger.addEventListener('click', () => document.body.classList.toggle('hub-menu-open'));
		const more = document.querySelector('#hub-more');
		if (more) more.addEventListener('click', (ev) => { ev.preventDefault(); document.body.classList.toggle('hub-menu-open'); });
		if (shade) shade.addEventListener('click', close);
		if (side) side.addEventListener('click', (ev) => { if (ev.target.closest('a[href]:not([href="#"])')) close(); });
	},

	renderSideMenu(tree, url) {
		const nav = document.querySelector('#hub-menu');
		if (!nav) return;
		const path = L.env.dispatchpath;
		const icon = (name) => E('span', { 'class': 'hub-ico', 'data-ico': ({ status: 'status', system: 'system', network: 'network', home: 'home', vpnhub: 'vpnhub', services: 'services', vpn: 'vpnhub', logout: 'logout' })[name] || 'services' });

		const self = this;
		const kids = ui.menu.getChildren(tree);
		/* the landing dashboard always leads the menu, also when the menu data leaves it out */
		if (!kids.some((k) => k.name === 'home') && L.env.nodespec !== undefined)
			nav.appendChild(E('a', { 'class': 'hub-item hub-solo' + ((path[1] === 'home' || !path[1]) ? ' active' : ''), 'href': L.url(url, 'home') }, [ icon('home'), _('Home') ]));

		kids.forEach((group) => {
			const items = ui.menu.getChildren(group);
			const groupActive = (path[1] === group.name);

			if (!items.length) {
				nav.appendChild(E('a', { 'class': 'hub-item hub-solo' + (groupActive ? ' active' : ''), 'href': L.url(url, group.name) }, [ icon(group.name), _(group.title) ]));
				return;
			}

			const list = E('div', { 'class': 'hub-items' }, items.map((item) => E('a', {
				'class': 'hub-item' + (groupActive && path[2] === item.name ? ' active' : ''),
				'href': L.url(url, group.name, item.name)
			}, [ _(item.title) ])));

			const head = E('a', { 'class': 'hub-group-head', 'href': '#' }, [ icon(group.name), E('span', {}, [ _(group.title) ]), E('i', {}) ]);
			const box = E('div', { 'class': 'hub-group' + (groupActive ? ' open' : '') }, [ head, list ]);
			/* one group open at a time: opening another folds the rest */
			head.addEventListener('click', (ev) => {
				ev.preventDefault();
				const opening = !box.classList.contains('open');
				nav.querySelectorAll('.hub-group.open').forEach((g) => g.classList.remove('open'));
				if (opening) box.classList.add('open');
			});
			nav.appendChild(box);
		});

		/* OpenWrt's own panel stays one click away; the VPNHUB settings bring this look back */
		if (L.env.sessionid !== undefined || document.querySelector('#hub-side')) {
			const old = E('a', { 'class': 'hub-item hub-solo hub-classic', 'href': '#', 'title': _('Use the original OpenWrt panel') }, [ icon('classic'), _('Classic panel') ]);
			old.addEventListener('click', (ev) => {
				ev.preventDefault();
				fs.exec('/usr/bin/vpnhub', [ 'look', 'classic' ]).then(() => { location.href = L.url('admin/status/overview'); });
			});
			nav.appendChild(old);
		}

	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach((child) => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(child.name, isActive ? 'active' : '') }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));
			if (isActive) activeNode = child;
		});

		if (ul.children.length == 0) return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode) this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	}
});
