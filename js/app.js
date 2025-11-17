// === Simulador Médico v3 — HOTFIX de evaluación ===
// Corrige casos donde la columna "respuesta" viene como:
//  - a, A, A), 1, C) texto, etc.
//  - el TEXTO literal de la opción correcta ("Axilar", "Femoral", etc.).
// También limpia espacios raros y caracteres invisibles, y funciona
// aunque se barajen las opciones.

// ===== Utilidades =====
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const toast = (m)=>{
  const t = $('#toast');
  if(!t) return;
  t.textContent = m;
  t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'),1400);
};
const dl = (name, content, mime='text/plain')=>{
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

// Limpia BOM, espacios raros, múltiples espacios, etc.
const clean = (s)=> (s ?? '')
  .replace(/\uFEFF/g,'')                         // BOM
  .replace(/[\u200B-\u200D\u2060\u00A0]/g,' ')   // ZWSP / NO-BREAK SPACE
  .replace(/\s+/g,' ')                           // colapsa espacios
  .trim();

// Dado el valor crudo de 'respuesta' y las opciones, devuelve 'A'|'B'|'C'|'D' o null
const normalizeRespuesta = (raw, opts)=>{
  const R = clean(String(raw)).toUpperCase();
  if(!R) return null;

  // Formas típicas: "A", "a", "A)", "A.", "A:", "C )"
  if(/^[ABCD]/.test(R)) return R[0];

  // Números 1..4
  if(/^[1-4]/.test(R)) return ['A','B','C','D'][parseInt(R[0],10)-1];

  // Si viene el TEXTO de la opción (ej. "Axilar")
  const map = {
    A: clean(opts?.A || ''),
    B: clean(opts?.B || ''),
    C: clean(opts?.C || ''),
    D: clean(opts?.D || '')
  };
  for(const k of ['A','B','C','D']){
    if(map[k] && clean(R) === map[k].toUpperCase()) return k;
  }

  // Si contiene una letra suelta en la frase (p.ej. "Respuesta: c)")
  const m = R.match(/\b[ABCD]\b/);
  if(m) return m[0];

  // Patrón genérico con paréntesis o corchetes: "(C)"
  const m2 = R.match(/[\(\[]?([ABCD])[\)\]]?/);
  if(m2) return m2[1];

  return null;
};

// ===== CSV robusto =====
function parseCSV(text){
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur = '';
  let row = [];
  let inQ = false;

  for(let i=0;i<text.length;i++){
    const c = text[i], n = text[i+1];
    if(c === '\"'){
      if(inQ && n === '\"'){ // comilla escapada
        cur += '\"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if(c === ',' && !inQ){
      row.push(cur);
      cur = '';
    } else if((c === '\n' || c === '\r') && !inQ){
      if(cur !== '' || row.length){
        row.push(cur);
      }
      if(row.length){
        rows.push(row);
        row = [];
      }
      cur = '';
    } else {
      cur += c;
    }
  }
  if(cur !== '' || row.length){
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const shuffle = a=>{
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
};

const hash = arr => arr
  .map(q=>q.pregunta + q.respuesta)
  .join('|')
  .split('')
  .reduce((a,c)=>((a<<5)-a) + c.charCodeAt(0), 0);

// ===== Estado global =====
let preguntas = [],
    idx = 0,
    ans = [],
    nombre = '—',
    incorrectas = [],
    quizHash = null,
    flags = [],
    notas = {};

let cfg = {
  minutos: 30,
  cantidad: 0,
  sq: true,  // shuffle questions
  so: true   // shuffle options
};

let rest = 1800;
let timer = null;
let paused = false;

// ===== Inicio (eventos básicos) =====
const fileInput = $('#file-input');

$('#btn-abrir')?.addEventListener('click', ()=>fileInput?.click());
$('#inicio-abrir')?.addEventListener('click', ()=>fileInput?.click());
$('#btn-plantilla')?.addEventListener('click', descargarPlantilla);
$('#inicio-plantilla')?.addEventListener('click', descargarPlantilla);
$('#btn-config')?.addEventListener('click', abrirConfig);
$('#btn-ayuda')?.addEventListener('click', ()=>$('#dlg-ayuda')?.showModal());

fileInput?.addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;

  nombre = f.name;
  const rows = parseCSV(await f.text());
  if(!rows.length){
    alert('CSV vacío');
    return;
  }

  // Encabezados
  const H = rows[0].map(h=>clean(h).toLowerCase());
  const need = ['pregunta','opcion_a','opcion_b','opcion_c','opcion_d','respuesta'];
  if(!need.every(k=>H.includes(k))){
    alert('Encabezados requeridos: ' + need.join(', '));
    return;
  }
  const I = k => H.indexOf(k);

  // Parseo con normalización de respuesta
  const out = [];
  let ambiguas = [];

  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(!r || (r.length === 1 && !clean(r[0]))) continue;

    const opciones = {
      A: clean(r[I('opcion_a')]),
      B: clean(r[I('opcion_b')]),
      C: clean(r[I('opcion_c')]),
      D: clean(r[I('opcion_d')])
    };

    const rawResp = clean(r[I('respuesta')]);
    const norm    = normalizeRespuesta(rawResp, opciones);

    const q = {
      pregunta: clean(r[I('pregunta')]) || '',
      opciones,
      // Si no se puede normalizar, se deja como 'A' solo para no romper,
      // pero se avisa en "ambiguas" para que el usuario revise ese ítem.
      respuesta: norm || 'A',
      categoria: (I('categoria') > -1 ? clean(r[I('categoria')]) : 'General') || 'General',
      explicacion: (I('explicacion') > -1 ? clean(r[I('explicacion')]) : '')
    };

    if(!norm) ambiguas.push(i+1);
    if(q.pregunta) out.push(q);
  }

  if(!out.length){
    alert('No se detectaron preguntas válidas');
    return;
  }

  if(ambiguas.length){
    setTimeout(()=>{
      alert(
        `Atención: ${ambiguas.length} fila(s) con respuesta ambigua ` +
        `(ej.: ${ambiguas.slice(0,8).join(', ')}${ambiguas.length>8?'…':''}).\n` +
        'Se intentó normalizar, pero te conviene revisar el CSV.'
      );
    }, 40);
  }

  preguntas = cfg.sq ? shuffle(out) : out;
  if(cfg.cantidad > 0){
    preguntas = preguntas.slice(0, cfg.cantidad);
  }

  quizHash = hash(preguntas);
  flags = new Array(preguntas.length).fill(false);
  notas = {};
  cargarLocal();
  reset();
  montarExamen();
});

function show(sel){
  ['#inicio','#examen','#resultado','#revision','#refuerzo','#estadisticas']
    .forEach(s => $(s)?.classList.add('hidden'));
  $(sel)?.classList.remove('hidden');
}

function montarExamen(){
  $('#archivo-nombre').textContent = nombre;
  $('#btn-prev').onclick = prev;
  $('#btn-next').onclick = next;
  $('#btn-fin').onclick = finalizar;
  $('#btn-guardar').onclick = ()=>guardarLocal();
  $('#btn-cambiar-archivo').onclick = ()=>fileInput.click();
  $('#btn-pausa').onclick = togglePausa;
  $('#btn-flag').onclick = toggleFlag;
  $('#btn-nota').onclick = abrirNota;

  document.addEventListener('keydown', onKeys);

  pintarPregunta();
  startTimer();
  renderNav();
  show('#examen');
}

function onKeys(e){
  if($('#examen').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if(k === 'p') return togglePausa();
  if(k === 'f') return toggleFlag();
  if(k === 'arrowleft') return prev();
  if(k === 'arrowright' || k === 'enter') return next();
  if(['a','b','c','d'].includes(k)) return elegir(k.toUpperCase());
}

function startTimer(){
  clearInterval(timer);
  rest = (cfg.minutos || 30)*60;
  $('#btn-pausa').textContent = '⏸ Pausa';
  paused = false;

  timer = setInterval(()=>{
    if(paused) return;
    rest--;
    if(rest < 0){
      clearInterval(timer);
      alert('Tiempo agotado');
      return finalizar();
    }
    const m = String(Math.floor(rest/60)).padStart(2,'0');
    const s = String(rest%60).padStart(2,'0');
    $('#timer').textContent = `${m}:${s}`;
  }, 1000);
}

function pintarPregunta(){
  const q = preguntas[idx];
  $('#progreso-texto').textContent = `Pregunta ${idx+1} de ${preguntas.length}`;
  $('#tag-categoria').textContent  = q.categoria || 'General';
  $('#tag-flag').textContent       = flags[idx] ? 'Marcada 🚩' : 'Sin marcar';
  $('#progreso-bar').style.width   = `${(idx/preguntas.length)*100}%`;
  $('#q-text').textContent         = `${idx+1}. ${q.pregunta}`;

  const cont = $('#opciones');
  cont.innerHTML = '';

  const K = ['A','B','C','D'];
  const order = cfg.so ? shuffle(K.slice()) : K;

  order.forEach(op=>{
    const el = document.createElement('label');
    el.className = 'option';
    el.innerHTML = `
      <input type="radio" name="op" value="${op}">
      <div><span class="pill">${op})</span> ${q.opciones[op]}</div>
    `;
    el.onclick = ()=>{
      el.querySelector('input').checked = true;
      elegir(op);
    };
    cont.appendChild(el);
  });

  const marcado = ans[idx];
  if(marcado){
    const radio = $$('input[name=op]').find(r=>r.value === marcado);
    if(radio) radio.checked = true;
  }

  $('#btn-prev').disabled = idx === 0;
  $('#btn-next').disabled = !marcado;
  renderNav();
}

function elegir(op){
  ans[idx] = op;
  $('#btn-next').disabled = false;
  renderNav();
}

function prev(){
  if(idx > 0){
    guardarLocal(true);
    idx--;
    pintarPregunta();
  }
}

function next(){
  if(!ans[idx]){
    alert('Selecciona una respuesta');
    return;
  }
  guardarLocal(true);
  idx++;
  if(idx < preguntas.length){
    pintarPregunta();
  } else {
    finalizar();
  }
}

function togglePausa(){
  paused = !paused;
  $('#btn-pausa').textContent = paused ? '▶️ Reanudar' : '⏸ Pausa';
}

function toggleFlag(){
  flags[idx] = !flags[idx];
  toast(flags[idx] ? 'Marcada 🚩' : 'Desmarcada');
  pintarPregunta();
}

function abrirNota(){
  $('#nota-texto').value = (notas[idx] || '');
  $('#dlg-nota').showModal();
}
$('#nota-ok').onclick = ()=>{
  notas[idx] = $('#nota-texto').value.trim();
  toast('Nota guardada');
};

function renderNav(filter='t'){
  const cont = $('#nav');
  cont.innerHTML = '';

  preguntas.forEach((q,i)=>{
    const answered = !!ans[i];

    if(filter === 'p' && answered) return;
    if(filter === 'm' && !flags[i]) return;

    const b = document.createElement('button');
    b.className = 'nav-item';
    b.dataset.state    = i === idx ? 'current' : '';
    b.dataset.answered = answered ? 'true' : 'false';
    b.dataset.pending  = answered ? 'false' : 'true';
    b.dataset.flag     = flags[i] ? 'true' : 'false';
    b.textContent = i+1;
    b.onclick = ()=>{
      idx = i;
      pintarPregunta();
    };
    cont.appendChild(b);
  });
}
$('#filtro-t')?.addEventListener('click', ()=>renderNav('t'));
$('#filtro-p')?.addEventListener('click', ()=>renderNav('p'));
$('#filtro-m')?.addEventListener('click', ()=>renderNav('m'));

// ===== Resultados =====
function finalizar(){
  clearInterval(timer);
  let ok = 0;
  incorrectas = [];

  preguntas.forEach((q,i)=>{
    // Seguridad extra: por si alguna respuesta quedara en formato raro
    const resp = ['A','B','C','D'].includes(q.respuesta)
      ? q.respuesta
      : (normalizeRespuesta(q.respuesta, q.opciones) || 'A');

    if(ans[i] === resp){
      ok++;
    } else {
      incorrectas.push({
        ...q,
        index: i,
        elegido: ans[i] || '-',
        respuesta: resp
      });
    }
  });

  const pct = (ok/preguntas.length)*100;
  $('#puntaje').textContent = `Puntaje: ${ok}/${preguntas.length} (${pct.toFixed(1)}%)`;

  const tone = pct >= 80
    ? { msg:'¡Excelente!',                    color:'var(--success)' }
    : pct >= 60
      ? { msg:'Bien, pero puedes más',        color:'var(--warn)'    }
      : { msg:'A repasar',                    color:'var(--danger)'  };

  $('#feedback').textContent = tone.msg;
  $('#feedback').style.color = tone.color;

  gauge('gauge', pct, tone.color);

  $('#btn-revisar').onclick   = ()=>mostrarRevision('t');
  $('#rev-t').onclick         = ()=>mostrarRevision('t');
  $('#rev-w').onclick         = ()=>mostrarRevision('w');
  $('#rev-volver').onclick    = ()=>show('#resultado');

  $('#btn-refuerzo').classList.toggle('hidden', incorrectas.length === 0);
  $('#btn-refuerzo').onclick  = mostrarRefuerzo;

  $('#btn-stats').onclick     = mostrarStats;
  $('#stats-volver').onclick  = ()=>show('#resultado');

  $('#btn-reintentar').onclick = reset;
  $('#btn-errores').onclick    = exportarErrores;

  show('#resultado');
  guardarLocal();
}

function gauge(id, pct, color){
  const c = document.getElementById(id);
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const cx = 110, cy = 110, r = 86;

  // Fondo
  ctx.strokeStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--border');
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*2.5);
  ctx.stroke();

  // Arco de resultado
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*(0.5+2*(pct/100)));
  ctx.stroke();

  // Texto
  ctx.fillStyle = color;
  ctx.font = 'bold 22px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pct.toFixed(1)+'%', cx, cy);
}

function mostrarRevision(mode){
  const list = $('#lista-revision');
  list.innerHTML = '';

  preguntas.forEach((q,i)=>{
    const resp = ['A','B','C','D'].includes(q.respuesta)
      ? q.respuesta
      : (normalizeRespuesta(q.respuesta, q.opciones) || 'A');

    const correcta = ans[i] === resp;
    if(mode === 'w' && correcta) return;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="muted" style="margin-bottom:6px">
        #${i+1} · <span class="badge">${q.categoria || 'General'}</span>
      </div>
      <div style="font-weight:800;margin-bottom:6px">${q.pregunta}</div>
    `;

    ['A','B','C','D'].forEach(k=>{
      const ok = k === resp;
      const marcado = ans[i] === k;
      const line = document.createElement('div');
      line.style.margin = '2px 0';
      line.textContent = `${ok ? '✅' : (marcado ? '✗' : '•')} ${k}) ${q.opciones[k]}`;
      line.style.color = ok
        ? 'var(--success)'
        : (marcado ? 'var(--danger)' : 'inherit');
      card.appendChild(line);
    });

    if(q.explicacion){
      const ex = document.createElement('div');
      ex.className = 'question';
      ex.style.marginTop = '8px';
      ex.innerHTML = `<strong>💡 Explicación:</strong><br>${q.explicacion}`;
      card.appendChild(ex);
    }

    if(notas[i]){
      const n = document.createElement('div');
      n.className = 'badge';
      n.style.marginTop = '8px';
      n.textContent = '📝 ' + notas[i];
      card.appendChild(n);
    }

    list.appendChild(card);
  });

  show('#revision');
}

// ===== Refuerzo + Flashcards =====
let fl_i = 0,
    fl_flip = false,
    fl_scores = {};

function mostrarRefuerzo(){
  $('#resumen-ref').textContent = `${incorrectas.length} preguntas`;
  const cats = [...new Set(incorrectas.map(q=>q.categoria || 'General'))];
  $('#cat-ref').innerHTML = `<option value="">Todas</option>` +
    cats.map(c=>`<option>${c}</option>`).join('');

  renderRef(incorrectas);
  fl_i = 0;
  fl_flip = false;
  renderFlash();

  $('#ref-volver').onclick   = ()=>show('#resultado');
  $('#buscar-ref').oninput   = filtrarRef;
  $('#cat-ref').onchange     = filtrarRef;
  $('#fl-prev').onclick      = ()=>{ if(fl_i>0){ fl_i--; fl_flip=false; renderFlash(); } };
  $('#fl-next').onclick      = ()=>{ if(fl_i<incorrectas.length-1){ fl_i++; fl_flip=false; renderFlash(); } };
  $('#fl-vol').onclick       = ()=>{ fl_flip=!fl_flip; renderFlash(); };

  $$('#refuerzo .btn[data-score]').forEach(b=>{
    b.onclick = ()=>{
      fl_scores[fl_i] = parseInt(b.dataset.score,10);
      toast('Guardado');
      renderFlash();
    };
  });

  show('#refuerzo');
}

function renderRef(arr){
  const cont = $('#lista-ref');
  cont.innerHTML = '';
  arr.forEach(q=>{
    const el = document.createElement('div');
    el.className = 'question';
    el.innerHTML = `<div style="font-weight:800;margin-bottom:4px">${q.pregunta}</div>`;
    ['A','B','C','D'].forEach(k=>{
      const line = document.createElement('div');
      line.style.margin = '2px 0';
      line.textContent = `${k}) ${q.opciones[k]}`;
      if(k === q.respuesta){
        line.style.color = 'var(--success)';
        line.style.fontWeight = '800';
      }
      el.appendChild(line);
    });
    if(q.explicacion){
      const b = document.createElement('div');
      b.className = 'badge';
      b.style.marginTop = '6px';
      b.textContent = '💡 ' + q.explicacion;
      el.appendChild(b);
    }
    cont.appendChild(el);
  });
}

function filtrarRef(){
  const t = $('#buscar-ref').value.toLowerCase();
  const c = $('#cat-ref').value;
  const arr = incorrectas.filter(q=>{
    const txt = (q.pregunta + ' ' + Object.values(q.opciones).join(' ')).toLowerCase();
    const okT = !t || txt.includes(t);
    const okC = !c || (q.categoria || 'General') === c;
    return okT && okC;
  });
  renderRef(arr);
}

function renderFlash(){
  const flash = $('#flash');
  const stats = $('#flash-stats');

  if(!incorrectas.length){
    flash.textContent = 'Nada que repasar';
    stats.textContent = '';
    return;
  }

  const q = incorrectas[fl_i];

  if(fl_flip){
    flash.textContent = `✅ ${q.respuesta}) ${q.opciones[q.respuesta]}` +
      (q.explicacion ? `\n\n💡 ${q.explicacion}` : '');
  } else {
    flash.textContent = q.pregunta;
  }

  const estud = Object.keys(fl_scores).length;
  const prom  = estud
    ? (Object.values(fl_scores).reduce((a,b)=>a+b,0)/estud).toFixed(1)
    : '—';

  stats.textContent = `Tarjeta ${fl_i+1}/${incorrectas.length} · ` +
    `Estudiadas: ${estud} · Dificultad media: ${prom}`;
}

// ===== Stats =====
function mostrarStats(){
  const T = preguntas.length;
  const C = preguntas.filter((q,i)=>ans[i] === q.respuesta).length;
  const I = T - C;
  $('#stat-t').textContent = T;
  $('#stat-c').textContent = C;
  $('#stat-i').textContent = I;

  const byCat = {};
  preguntas.forEach((q,i)=>{
    const c = q.categoria || 'General';
    byCat[c] ??= {t:0,c:0};
    byCat[c].t++;
    if(ans[i] === q.respuesta) byCat[c].c++;
  });

  const cont = $('#stats-cat');
  cont.innerHTML = '';
  Object.entries(byCat)
    .sort((a,b)=>b[1].t - a[1].t)
    .forEach(([cat,st])=>{
      const pct = (st.c/st.t)*100;
      const div = document.createElement('div');
      div.className = 'grid';
      div.innerHTML = `
        <div class="row space-between">
          <strong>${cat}</strong>
          <span>${st.c}/${st.t} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="progress"><div style="width:${pct.toFixed(1)}%"></div></div>
      `;
      cont.appendChild(div);
    });

  $('#exp-json').onclick = exportarJSON;
  $('#imp-json').onclick = ()=>$('#file-json').click();
  $('#file-json').onchange = importarJSON;

  show('#estadisticas');
}

// ===== Local storage =====
const sk = ()=> `simv3:${quizHash}:${nombre}`;

function guardarLocal(silent=false){
  if(!preguntas.length) return;
  const data = {idx,ans,rest,nombre,quizHash,flags,notas,cfg};
  localStorage.setItem(sk(), JSON.stringify(data));
  if(!silent) toast('Progreso guardado');
}

function cargarLocal(){
  try{
    for(const [k,v] of Object.entries(localStorage)){
      try{
        const d = JSON.parse(v);
        if(d && d.quizHash && d.nombre === nombre){
          idx   = d.idx   || 0;
          ans   = d.ans   || [];
          rest  = d.rest  || (cfg.minutos*60);
          flags = d.flags || new Array(preguntas.length).fill(false);
          notas = d.notas || {};
          cfg   = d.cfg   || cfg;
          toast('Progreso cargado');
          break;
        }
      }catch{}
    }
  }catch{}
}

function exportarJSON(){
  const data = {idx,ans,rest,nombre,quizHash,flags,notas,cfg};
  dl('progreso_simv3.json', JSON.stringify(data, null, 2), 'application/json');
}

function importarJSON(e){
  const f = e.target.files[0];
  if(!f) return;
  const R = new FileReader();
  R.onload = ()=>{
    try{
      const d = JSON.parse(R.result);
      if(d.quizHash !== quizHash){
        alert('Progreso no corresponde a este banco');
        return;
      }
      idx   = d.idx   || 0;
      ans   = d.ans   || [];
      rest  = d.rest  || cfg.minutos*60;
      flags = d.flags || new Array(preguntas.length).fill(false);
      notas = d.notas || {};
      cfg   = d.cfg   || cfg;
      pintarPregunta();
      toast('Progreso importado');
    }catch{
      alert('JSON inválido');
    }
  };
  R.readAsText(f);
}

// ===== Config =====
function abrirConfig(){
  $('#cfg-min').value = cfg.minutos;
  $('#cfg-n').value   = cfg.cantidad;
  $('#cfg-sq').checked= cfg.sq;
  $('#cfg-so').checked= cfg.so;
  $('#dlg-config').showModal();
}
$('#cfg-ok').onclick = ()=>{
  cfg.minutos  = Math.max(5, parseInt($('#cfg-min').value || '30',10));
  cfg.cantidad = Math.max(0, parseInt($('#cfg-n').value   || '0',10));
  cfg.sq       = $('#cfg-sq').checked;
  cfg.so       = $('#cfg-so').checked;
  toast('Configuración guardada');
};

// ===== Exportar errores =====
function exportarErrores(){
  if(!incorrectas.length){
    toast('Nada que exportar');
    return;
  }
  const H = [
    'pregunta','opcion_a','opcion_b','opcion_c',
    'opcion_d','respuesta','categoria','explicacion'
  ];
  const lines = [H.join(',')];

  incorrectas.forEach(q=>{
    const esc = v => '"' + (v || '').replaceAll('"','""') + '"';
    lines.push([
      q.pregunta,
      q.opciones.A,
      q.opciones.B,
      q.opciones.C,
      q.opciones.D,
      q.respuesta,
      q.categoria || 'General',
      q.explicacion || ''
    ].map(esc).join(','));
  });

  dl('errores_refuerzo.csv', lines.join('\n'), 'text/csv');
}

// ===== Reset =====
function reset(){
  idx = 0;
  ans = [];
  incorrectas = [];
  rest = cfg.minutos*60;
  fl_scores = {};
  fl_flip = false;
  fl_i = 0;
  if(preguntas.length){
    pintarPregunta();
    startTimer();
    show('#examen');
  }
}

// ===== Plantilla =====
function descargarPlantilla(){
  const H = [
    'pregunta','opcion_a','opcion_b',
    'opcion_c','opcion_d','respuesta',
    'categoria','explicacion'
  ];
  const rows = [
    H.join(','),
    '¿Cuál drena el encéfalo?,Vena yugular interna,Vena basílica,Vena femoral,Vena esplénica,A,Anatomía,Principal vía de drenaje del encéfalo y cuello profundo.',
    '¿Dónde se sintetiza ATP principalmente?,Mitocondria,Cloroplasto,Lisosoma,Ribosoma,A,Bioquímica,Fosforilación oxidativa.',
    'Par craneal del olfato,I,II,III,IV,A,Neuro,Sensorial: I par craneal.'
  ];
  dl('plantilla_simulador.csv', rows.join('\n'), 'text/csv');
}
