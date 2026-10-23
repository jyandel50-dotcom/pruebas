// Pruebas del módulo P1 (estabilización del prototipo ADOPT ME).
// Uso: node test_p1.js <archivo.html>
// Carga el HTML en jsdom, ejecuta el JS real de la página y simula interacciones.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

async function load() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/index.html', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.__scrolled = 0;
      w.Element.prototype.scrollIntoView = function () { w.__scrolled++; };
      w.URL.createObjectURL = () => 'blob:test';
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {}; // evita navegar en descargas
      w.addEventListener('error', e => errors.push(String(e.message)));
    }
  });
  const w = dom.window;
  const ctx = {
    w, errors, doc: w.document,
    ev: code => w.eval(code),
    nav: async h => { w.location.hash = h; await tick(); },
    app: () => w.document.getElementById('app'),
    text: () => w.document.getElementById('app').textContent.replace(/\s+/g, ' '),
    modal: () => w.document.getElementById('modal-root'),
    login: async rol => { w.eval(`demoLogin('${rol}')`); await tick(); },
    user: () => w.eval('state.user'),
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    btnByText: t => [...w.document.querySelectorAll('button,a')].find(b => b.textContent.includes(t)),
  };
  await tick();
  return ctx;
}

const results = [];
async function test(id, name, fn) {
  let c;
  try {
    c = await load();
    await fn(c);
    results.push([id, name, true, '']);
  } catch (e) {
    results.push([id, name, false, e.message.split('\n')[0]]);
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  // ---------- M2 ----------
  await test('M2', 'Saludo del panel sin la palabra suelta "wave"', async c => {
    await c.login('usuario');
    const h1 = c.doc.querySelector('h1').textContent;
    ok(h1.includes('Hola, María'), 'no muestra el saludo: ' + h1);
    ok(!/wave/.test(h1), 'el saludo aún contiene "wave": ' + h1);
  });

  // ---------- C4 ----------
  await test('C4', 'Edad y salud con HTML no se inyectan en el detalle', async c => {
    c.ev(`petById(1).edad='<img src=x id="pwn1">'; petById(1).salud='<b id="pwn2">x</b>'; petById(1).tamano='<i id="pwn3">y</i>';`);
    await c.nav('#/mascota/1');
    ok(!c.doc.getElementById('pwn1'), 'se inyectó <img> desde p.edad');
    ok(!c.doc.getElementById('pwn2'), 'se inyectó <b> desde p.salud');
    ok(!c.doc.getElementById('pwn3'), 'se inyectó <i> desde p.tamano');
    ok(c.text().includes('<img src=x'), 'el texto malicioso no se muestra literal');
  });

  // ---------- C5 ----------
  await test('C5a', 'Nombre de refugio con comilla no rompe ni ejecuta JS (detalle)', async c => {
    c.ev(`refugioById(1).nombre="O'Neil\\");window.__pwn=1;//"`);
    await c.nav('#/mascota/1');
    const b = c.btnByText('Contactar refugio');
    ok(b, 'no existe el botón Contactar refugio');
    b.click(); await tick();
    ok(c.w.__pwn === undefined, 'SE EJECUTÓ código inyectado');
    ok(c.modal().querySelector('.modal-box'), 'el modal no abrió (el onclick se rompió)');
    ok(c.modal().textContent.includes("O'Neil"), 'el modal no muestra el nombre del refugio');
  });
  await test('C5b', 'Nombre de solicitante con comilla no rompe el botón Contactar (refugio)', async c => {
    c.ev(`REQUESTS[0].userNombre="D'Arc\\");window.__pwn=1;//"`);
    await c.login('refugio');
    await c.nav('#/refugio/solicitudes');
    const b = c.doc.querySelector('button[title="Contactar"]');
    ok(b, 'no hay botón Contactar');
    b.click(); await tick();
    ok(c.w.__pwn === undefined, 'SE EJECUTÓ código inyectado');
    ok(c.modal().querySelector('.modal-box'), 'el modal no abrió');
  });

  // ---------- C7 ----------
  await test('C7a', 'Un usuario que se llama "María Gómez" con otro correo/id no ve solicitudes ajenas', async c => {
    c.ev(`state.user={id:77,nombre:'María Gómez',email:'otra@x.com',rol:'usuario'}`);
    await c.nav('#/dashboard');
    const stat = [...c.doc.querySelectorAll('.stat-card')].find(s => s.textContent.includes('Solicitudes enviadas'));
    ok(stat.querySelector('.stat-num').textContent.trim() === '0', 'dashboard cuenta solicitudes ajenas: ' + stat.querySelector('.stat-num').textContent);
    await c.nav('#/seguimiento');
    ok(!c.text().includes('Solicitud #'), 'el seguimiento muestra solicitudes ajenas');
  });
  await test('C7b', 'El adoptante demo ve exactamente sus 2 solicitudes (#101, #104)', async c => {
    await c.login('usuario');
    await c.nav('#/seguimiento');
    const t = c.text();
    ok(t.includes('Solicitud #101') && t.includes('Solicitud #104'), 'faltan solicitudes propias');
    ok(!t.includes('Solicitud #102') && !t.includes('Solicitud #103'), 'muestra solicitudes de otros');
  });

  // ---------- A5 ----------
  await test('A5a', 'Escribir en el buscador del catálogo conserva foco y texto', async c => {
    await c.nav('#/catalogo');
    const inp = c.doc.querySelector('.filter-bar input');
    inp.focus(); inp.value = 'lu'; c.fire(inp, 'input'); await tick();
    const now = c.doc.querySelector('.filter-bar input');
    ok(c.doc.activeElement === now, 'el input perdió el foco tras escribir');
    ok(now.value === 'lu', 'el input perdió su texto');
    ok(c.text().includes('Luna') && !c.text().includes('Simón'), 'el filtro no afectó a los resultados');
  });
  await test('A5b', 'El filtro de edad queda visible tras aplicarlo', async c => {
    await c.nav('#/catalogo');
    const sel = c.doc.querySelectorAll('.filter-bar select')[2];
    sel.value = 'joven'; c.fire(sel, 'change'); await tick();
    ok(c.doc.querySelectorAll('.filter-bar select')[2].value === 'joven', 'el select muestra "todas" aunque el filtro está activo');
  });
  await test('A5c', 'Abrir el menú de usuario no borra lo escrito en el formulario de solicitud', async c => {
    await c.login('usuario');
    await c.nav('#/solicitud/1');
    c.doc.getElementById('s-motivo').value = 'texto de prueba';
    c.doc.querySelector('.user-chip').click(); await tick();
    const m = c.doc.getElementById('s-motivo');
    ok(m && m.value === 'texto de prueba', 'el formulario perdió los datos escritos');
    ok(c.doc.getElementById('user-dropdown').classList.contains('open'), 'el menú no se abrió');
  });
  await test('A5d', 'Menú móvil y sidebar alternan sin reemplazar el DOM', async c => {
    await c.login('usuario');
    const side = c.doc.querySelector('.sidebar');
    c.w.eval('toggleSidebar()');
    ok(c.doc.querySelector('.sidebar') === side, 'toggleSidebar reconstruyó el DOM');
    ok(side.classList.contains('open'), 'el sidebar no se abrió');
    c.w.eval('toggleMobileNav()');
    ok(c.doc.querySelector('.mobile-menu').classList.contains('open'), 'el menú móvil no se abrió');
  });
  await test('A5e', 'Clic fuera cierra el menú de usuario', async c => {
    await c.login('usuario');
    c.doc.querySelector('.user-chip').click(); await tick();
    c.doc.querySelector('.main-content h1').click(); await tick();
    ok(!c.doc.getElementById('user-dropdown').classList.contains('open'), 'el menú sigue abierto');
  });

  // ---------- A6 ----------
  await test('A6a', 'La landing muestra adopciones reales (sin "+18")', async c => {
    const real = c.ev(`PETS.filter(p=>p.estado==='adoptado').length`);
    const shown = [...c.doc.querySelectorAll('.hero-stats div')][2].querySelector('b').textContent.trim();
    ok(Number(shown) === real, `muestra ${shown}, el dato real es ${real}`);
  });
  await test('A6b', 'El formulario no promete "fecha y hora del servidor"', async c => {
    await c.login('usuario');
    await c.nav('#/solicitud/1');
    ok(!/servidor/i.test(c.text()), 'aún menciona al servidor');
  });
  await test('A6c', 'No hay botón "Descargar certificado" falso en solicitudes aprobadas', async c => {
    c.ev(`REQUESTS.find(r=>r.id===101).estado='aprobada'`);
    await c.login('usuario');
    await c.nav('#/seguimiento');
    ok(!c.text().includes('Descargar certificado'), 'sigue el botón falso');
    ok(c.text().includes('Contactar'), 'no hay forma real de contactar al refugio');
  });
  await test('A6d', 'Contactar refugio muestra datos reales (mailto/tel) y no un envío falso', async c => {
    await c.nav('#/mascota/1');
    c.btnByText('Contactar refugio').click(); await tick();
    const m = c.modal();
    ok(m.querySelector('a[href^="mailto:camila@huellasfelices.org"]'), 'no hay enlace mailto con el correo del refugio');
    ok(m.querySelector('a[href^="tel:"]'), 'no hay enlace tel');
    ok(!m.querySelector('textarea'), 'sigue el formulario de mensaje que no envía nada');
  });
  await test('A6e', 'Login sin checkbox "Recordarme" decorativo', async c => {
    await c.nav('#/login');
    ok(!c.text().includes('Recordarme'), 'sigue el checkbox');
  });
  await test('A6f', 'El enlace de términos abre un aviso y no navega a "#"', async c => {
    await c.nav('#/registro');
    const a = [...c.doc.querySelectorAll('a')].find(x => x.textContent.includes('términos y condiciones'));
    ok(a, 'no existe el enlace');
    a.dispatchEvent(new c.w.MouseEvent('click',{bubbles:true,cancelable:true})); await tick();
    ok(c.w.location.hash === '#/registro', 'navegó a ' + c.w.location.hash);
    ok(c.modal().querySelector('.modal-box'), 'no abrió el aviso');
  });
  await test('A6g', 'La zona de fotos no finge subir archivos', async c => {
    await c.login('refugio');
    await c.nav('#/refugio/mascotas/nueva');
    ok(!c.text().includes('Arrastra'), 'sigue diciendo "Arrastra imágenes"');
  });
  await test('A6h', 'Tarjetas de la landing no están fijas a Luna/Michi', async c => {
    c.ev(`petById(1).estado='adoptado'`); c.ev('render()');
    ok(!c.doc.querySelector('.hero-visual').textContent.includes('Luna'), 'el hero sigue mostrando a Luna adoptada como disponible');
  });
  await test('A6i', 'La landing no se rompe si se elimina una mascota', async c => {
    c.ev(`PETS=PETS.filter(p=>p.id!==1&&p.id!==4)`); c.ev('render()');
    ok(c.app().innerHTML.length > 500, 'la landing quedó vacía');
    ok(c.errors.length === 0, 'errores JS: ' + c.errors[0]);
  });

  // ---------- A3 ----------
  await test('A3a', 'Borrador no accesible por URL para el público', async c => {
    await c.nav('#/mascota/9');
    ok(c.text().includes('404') && !c.text().includes('Bella'), 'el público ve el borrador de Bella');
  });
  await test('A3b', 'El refugio dueño y el admin sí ven el borrador; otro refugio no', async c => {
    await c.login('refugio'); c.ev('state.user.refugioId=3'); await c.nav('#/mascota/9');
    ok(c.text().includes('Bella'), 'el dueño no ve su borrador');
    c.ev('state.user.refugioId=1'); c.ev('render()');
    ok(c.text().includes('404'), 'otro refugio ve un borrador ajeno');
    c.ev(`state.user={id:1,nombre:'Admin',rol:'admin',email:'a@a.com'}`); c.ev('render()');
    ok(c.text().includes('Bella'), 'el admin no ve el borrador');
  });
  await test('A3c', 'Mascota adoptada: se muestra pero sin botón de solicitar', async c => {
    await c.nav('#/mascota/7');
    ok(c.text().includes('Max'), 'no se muestra la mascota adoptada');
    ok(!c.btnByText('Solicitar adopción'), 'permite solicitar una mascota adoptada');
  });
  await test('A3d', '/solicitud/:id de mascota no disponible redirige al detalle', async c => {
    await c.login('usuario');
    await c.nav('#/solicitud/3'); // Rocky: en proceso
    ok(!c.doc.getElementById('s-motivo'), 'muestra el formulario para una mascota no disponible');
    ok(c.w.location.hash === '#/mascota/3', 'no redirigió; hash=' + c.w.location.hash);
  });
  await test('A3e', '/solicitud/:id de un borrador devuelve 404', async c => {
    await c.login('usuario');
    await c.nav('#/solicitud/9');
    ok(c.text().includes('404'), 'permite solicitar un borrador');
  });
  await test('A3f', 'No se puede duplicar una solicitud pendiente del mismo usuario', async c => {
    await c.login('usuario');
    const send = async () => {
      await c.nav('#/solicitud/5');
      const m = c.doc.getElementById('s-motivo'); if (!m) return;
      m.value = 'quiero adoptar';
      c.doc.querySelectorAll('.s-compromiso').forEach(x => x.checked = true);
      c.w.eval('submitSolicitud(5)'); await tick();
    };
    await send();
    c.ev(`petById(5).estado='disponible'`);
    await send();
    const n = c.ev(`REQUESTS.filter(r=>r.petId===5&&r.userNombre==='María Gómez'&&r.estado==='pendiente').length`);
    ok(n === 1, `hay ${n} solicitudes pendientes duplicadas`);
  });

  // ---------- A4 ----------
  await test('A4a', 'Refugio suspendido: sus mascotas desaparecen del catálogo y del detalle público', async c => {
    await c.login('admin');
    c.w.eval('toggleRefugioStatus(1)');
    c.w.eval('doLogout()'); await tick();
    await c.nav('#/catalogo');
    ok(!c.text().includes('Luna') && !c.text().includes('Rocky'), 'el catálogo sigue mostrando mascotas de un refugio suspendido');
    await c.nav('#/mascota/1');
    ok(c.text().includes('404'), 'el detalle sigue accesible');
  });
  await test('A4b', 'Refugio suspendido no puede iniciar sesión', async c => {
    c.ev(`refugioById(1).estado='inactivo'`);
    await c.login('refugio');
    ok(c.user() === null, 'inició sesión un refugio suspendido');
  });
  await test('A4c', 'Desactivar cuenta cierra sesión y bloquea el reingreso; el admin puede reactivar', async c => {
    await c.login('usuario');
    c.w.eval('confirmDeactivate()');
    c.doc.getElementById('modal-confirm-btn').click(); await tick();
    ok(c.user() === null, 'la sesión sigue abierta tras desactivar');
    await c.login('usuario');
    ok(c.user() === null, 'pudo volver a entrar con la cuenta desactivada');
    await c.login('admin');
    c.w.eval('toggleUserStatus(1)'); // reactivar
    c.w.eval('doLogout()'); await tick();
    await c.login('usuario');
    ok(c.user() && c.user().rol === 'usuario', 'no pudo entrar tras reactivar');
  });

  // ---------- M3 / M4 / M8 ----------
  await test('M3', 'Todas las claves de toast existen en TOAST_ICONS', async c => {
    const keys = Object.keys(c.ev('TOAST_ICONS'));
    const bad = new Set();
    for (const line of html.split('\n')) {
      if (!line.includes('toast(') || line.includes('function toast')) continue;
      for (const m of line.matchAll(/toast\(.*?,\s*'([^']+)'\)/g)) if (!keys.includes(m[1])) bad.add(m[1]);
    }
    ok(bad.size === 0, 'claves sin icono: ' + [...bad].join(' '));
  });
  await test('M4a', 'Sin código muerto ni texto corrupto en la navegación', async () => {
    ok(!html.includes('Comentichles'), 'sigue "Comentichles"');
    ok(!html.includes('function publicLinks'), 'sigue publicLinks()');
  });
  await test('M4b', '/nosotros lleva a la sección "Sobre nosotros" de la landing', async c => {
    await c.nav('#/nosotros');
    ok(c.doc.getElementById('sobre-nosotros'), 'no existe la sección ancla');
    ok(c.w.__scrolled > 0, 'no hizo scroll a la sección');
    const link = [...c.doc.querySelectorAll('.nav-links .nav-link')].find(a => a.textContent.includes('Sobre nosotros'));
    ok(link && link.classList.contains('active'), 'el enlace no se marca activo');
  });
  await test('M8', 'Badge "en proceso" coherente en tarjeta, detalle y panel del refugio', async c => {
    await c.nav('#/catalogo');
    c.ev(`state.statusFilter='en proceso'`); c.ev('render()');
    ok(c.app().querySelector('.pet-card .badge-proceso'), 'tarjeta sin badge-proceso');
    await c.nav('#/mascota/3');
    ok(c.app().querySelector('.badge-proceso'), 'detalle sin badge-proceso');
    await c.login('refugio'); await c.nav('#/refugio/dashboard');
    ok(c.app().querySelector('.badge-proceso'), 'panel sin badge-proceso');
  });

  // ---------- Regresión: humo por rol ----------
  const routes = {
    publico: ['#/', '#/catalogo', '#/mascota/1', '#/login', '#/registro', '#/recuperar', '#/nosotros', '#/ruta-inexistente'],
    usuario: ['#/dashboard', '#/catalogo', '#/favoritos', '#/seguimiento', '#/perfil', '#/notificaciones', '#/solicitud/1', '#/mascota/2'],
    refugio: ['#/refugio/dashboard', '#/refugio/mascotas', '#/refugio/mascotas/nueva', '#/refugio/mascotas/editar/1', '#/refugio/solicitudes', '#/refugio/perfil', '#/notificaciones'],
    admin: ['#/admin/dashboard', '#/admin/usuarios', '#/admin/refugios', '#/admin/solicitudes', '#/admin/reportes', '#/notificaciones'],
  };
  for (const [rol, list] of Object.entries(routes)) {
    await test('R-' + rol, `Humo: ${list.length} rutas de ${rol} renderizan sin errores`, async c => {
      if (rol !== 'publico') await c.login(rol);
      for (const r of list) {
        await c.nav(r);
        ok(c.app().innerHTML.length > 200, `ruta vacía: ${r}`);
        ok(c.errors.length === 0, `error JS en ${r}: ${c.errors[0]}`);
      }
    });
  }
  await test('R-flujo', 'Humo: flujo completo solicitar → aprobar → exportar CSV', async c => {
    await c.login('usuario');
    await c.nav('#/solicitud/2');
    c.doc.getElementById('s-motivo').value = 'motivo';
    c.doc.querySelectorAll('.s-compromiso').forEach(x => x.checked = true);
    c.w.eval('submitSolicitud(2)'); await tick();
    ok(c.ev(`petById(2).estado`) === 'en proceso', 'la mascota no pasó a "en proceso"');
    c.w.eval('doLogout()'); await tick();
    await c.login('admin');
    const id = c.ev(`REQUESTS[REQUESTS.length-1].id`);
    c.w.eval(`approveReq(${id})`); c.doc.getElementById('modal-confirm-btn').click(); await tick();
    ok(c.ev(`petById(2).estado`) === 'adoptado', 'la mascota no quedó adoptada');
    c.w.eval(`exportCSV('adopciones')`);
    ok(c.errors.length === 0, 'errores JS: ' + c.errors[0]);
  });

  // ---------- Reporte ----------
  let fail = 0;
  for (const [id, name, pass, why] of results) {
    if (!pass) fail++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}${pass ? '' : '\n        -> ' + why}`);
  }
  console.log(`\n${results.length - fail}/${results.length} pruebas pasan`);
  process.exit(0);
})();
