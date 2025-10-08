// ===== Util =====
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const toast = (m)=>{ const t=$('#toast'); t.textContent=m; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),1400); };
const dl = (name, content, mime='text/plain')=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); };

// CSV robusto
function parseCSV(text){
  if (text && text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  const rows=[]; let cur=''; let row=[]; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='\"'){ if(inQ && n==='\"'){ cur+='\"'; i++; } else inQ=!inQ; }
    else if(c===',' && !inQ){ row.push(cur); cur=''; }
    else if((c==='\n'||c==='\r') && !inQ){ if(cur!==''||row.length){row.push(cur);} if(row.length){rows.push(row); row=[];} cur=''; }
    else cur+=c;
  }
  if(cur!==''||row.length){row.push(cur); rows.push(row);}
  return rows;
}
const shuffle = a=>{ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; };
const hash = arr => arr.map(q=>q.pregunta+q.respuesta).join('|').split('').reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0);

// ===== Estado =====
let preguntas=[], idx=0, ans=[], nombre='—', incorrectas=[], quizHash=null, flags=[], notas={};
let cfg = { minutos:30, cantidad:0, sq:true, so:true };
let rest=1800, timer=null, paused=false;

// ===== Inicio =====
const fileInput = $('#file-input');
$('#btn-abrir').onclick = ()=>fileInput.click();
$('#inicio-abrir').onclick = ()=>fileInput.click();
$('#btn-plantilla').onclick = descargarPlantilla;
$('#inicio-plantilla').onclick = descargarPlantilla;
$('#btn-config').onclick = abrirConfig;
$('#btn-ayuda').onclick = ()=>$('#dlg-ayuda').showModal();
const _temaBtn = $('#btn-tema'); if(_temaBtn){ _temaBtn.remove(); }

fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  nombre = f.name;
  const rows = parseCSV(await f.text());
  if(!rows.length) return alert('CSV vacío');
  const H = rows[0].map(h=>h.trim().toLowerCase());
  const need = ['pregunta','opcion_a','opcion_b','opcion_c','opcion_d','respuesta'];
  if(!need.every(k=>H.includes(k))) return alert('Encabezados requeridos: '+need.join(', '));
  const I = k=>H.indexOf(k);
  const out=[];
  for(let i=1;i<rows.length;i++){
    const r = rows[i]; if(!r || (r.length===1 && !r[0].trim())) continue;
    const q = {
      pregunta: r[I('pregunta')]?.trim()||'',
      opciones: {A:r[I('opcion_a')]||'', B:r[I('opcion_b')]||'', C:r[I('opcion_c')]||'', D:r[I('opcion_d')]||''},
      respuesta: (r[I('respuesta')]||'').trim().toUpperCase(),
      categoria: (I('categoria')>-1? r[I('categoria')]: 'General')?.trim()||'General',
      explicacion: (I('explicacion')>-1? r[I('explicacion')]: '')?.trim()||''
    };
    if(q.pregunta) out.push(q);
  }
  if(!out.length) return alert('No se detectaron preguntas válidas');
  preguntas = cfg.sq? shuffle(out) : out;
  if(cfg.cantidad>0) preguntas = preguntas.slice(0, cfg.cantidad);
  quizHash = hash(preguntas);
  flags = new Array(preguntas.length).fill(false);
  notas = {};
  cargarLocal();
  reset();
  montarExamen();
});

function show(id){
  ['#inicio','#examen','#resultado','#revision','#refuerzo','#estadisticas'].forEach(s=>$(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function montarExamen(){
  $('#archivo-nombre').textContent = nombre;
  $('#btn-prev').onclick = prev; $('#btn-next').onclick = next; $('#btn-fin').onclick = finalizar;
  $('#btn-guardar').onclick = ()=>guardarLocal();
  $('#btn-cambiar-archivo').onclick = ()=>fileInput.click();
  $('#btn-pausa').onclick = togglePausa;
  $('#btn-flag').onclick = toggleFlag; $('#btn-nota').onclick = abrirNota;
  document.addEventListener('keydown', onKeys);
  pintarPregunta(); startTimer();
  renderNav();
  show('#examen');
}
function onKeys(e){
  if($('#examen').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if(k==='p') return togglePausa();
  if(k==='f') return toggleFlag();
  if(k==='arrowleft') return prev();
  if(k==='arrowright' || k==='enter') return next();
  if(['a','b','c','d'].includes(k)) return elegir(k.toUpperCase());
}

function startTimer(){
  clearInterval(timer);
  rest = (cfg.minutos||30)*60;
  $('#btn-pausa').textContent = '⏸ Pausa';
  paused=false;
  timer = setInterval(()=>{
    if(paused) return;
    rest--;
    if(rest<0){ clearInterval(timer); alert('Tiempo agotado'); return finalizar(); }
    const m = String(Math.floor(rest/60)).padStart(2,'0');
    const s = String(rest%60).padStart(2,'0');
    $('#timer').textContent = `${m}:${s}`;
  },1000);
}

function pintarPregunta(){
  const q = preguntas[idx];
  $('#progreso-texto').textContent = `Pregunta ${idx+1} de ${preguntas.length}`;
  $('#tag-categoria').textContent = q.categoria||'General';
  $('#tag-flag').textContent = flags[idx] ? 'Marcada 🚩' : 'Sin marcar';
  $('#progreso-bar').style.width = `${(idx/preguntas.length)*100}%`;
  $('#q-text').textContent = `${idx+1}. ${q.pregunta}`;
  const cont = $('#opciones'); cont.innerHTML='';
  const K = ['A','B','C','D']; const order = cfg.so? shuffle(K.slice()):K;
  order.forEach(op=>{
    const el = document.createElement('label'); el.className='option';
    el.innerHTML = `<input type="radio" name="op" value="${op}"><div><span class="pill">${op})</span> ${q.opciones[op]}</div>`;
    el.onclick = ()=>{ el.querySelector('input').checked=true; elegir(op); };
    cont.appendChild(el);
  });
  const marcado = ans[idx];
  if(marcado){ const radio = $$('input[name=op]').find(r=>r.value===marcado); if(radio) radio.checked=true; }
  $('#btn-prev').disabled = idx===0;
  $('#btn-next').disabled = !marcado;
  renderNav();
}
function elegir(op){ ans[idx]=op; $('#btn-next').disabled=false; renderNav(); }
function prev(){ if(idx>0){ guardarLocal(true); idx--; pintarPregunta(); } }
function next(){ if(!ans[idx]) return alert('Selecciona una respuesta'); guardarLocal(true); idx++; if(idx<preguntas.length) pintarPregunta(); else finalizar(); }
function togglePausa(){ paused=!paused; $('#btn-pausa').textContent = paused? '▶️ Reanudar':'⏸ Pausa'; }
function toggleFlag(){ flags[idx]=!flags[idx]; toast(flags[idx]?'Marcada 🚩':'Desmarcada'); pintarPregunta(); }
function abrirNota(){ $('#nota-texto').value = (notas[idx]||''); $('#dlg-nota').showModal(); }
$('#nota-ok').onclick = ()=>{ notas[idx] = $('#nota-texto').value.trim(); toast('Nota guardada'); };

function renderNav(filter='t'){
  const cont = $('#nav'); cont.innerHTML='';
  preguntas.forEach((q,i)=>{
    const answered = !!ans[i];
    if(filter==='p' && answered) return;
    if(filter==='m' && !flags[i]) return;
    const b = document.createElement('button');
    b.className='nav-item';
    b.dataset.state = i===idx? 'current':'';
    b.dataset.answered = answered? 'true':'false';
    b.dataset.pending = answered? 'false':'true';
    b.dataset.flag = flags[i]? 'true':'false';
    b.textContent = i+1;
    b.onclick = ()=>{ idx=i; pintarPregunta(); };
    cont.appendChild(b);
  });
}
$('#filtro-t').onclick = ()=>renderNav('t');
$('#filtro-p').onclick = ()=>renderNav('p');
$('#filtro-m').onclick = ()=>renderNav('m');

// ===== Resultados =====
function finalizar(){
  clearInterval(timer);
  let ok=0; incorrectas=[];
  preguntas.forEach((q,i)=>{
    if(ans[i]===q.respuesta) ok++;
    else incorrectas.push({...q, index:i, elegido:ans[i]||'-'});
  });
  const pct = (ok/preguntas.length)*100;
  $('#puntaje').textContent = `Puntaje: ${ok}/${preguntas.length} (${pct.toFixed(1)}%)`;
  const tone = pct>=80? {msg:'¡Excelente!', color:'var(--success)'} : pct>=60? {msg:'Bien, pero puedes más', color:'var(--warn)'} : {msg:'A repasar', color:'var(--danger)'};
  $('#feedback').textContent = tone.msg; $('#feedback').style.color=tone.color;
  gauge('gauge', pct, tone.color);
  $('#btn-revisar').onclick = ()=>mostrarRevision('t');
  $('#rev-t').onclick = ()=>mostrarRevision('t');
  $('#rev-w').onclick = ()=>mostrarRevision('w');
  $('#rev-volver').onclick = ()=>show('#resultado');
  $('#btn-refuerzo').classList.toggle('hidden', incorrectas.length===0);
  $('#btn-refuerzo').onclick = mostrarRefuerzo;
  $('#btn-stats').onclick = mostrarStats;
  $('#stats-volver').onclick = ()=>show('#resultado');
  $('#btn-reintentar').onclick = reset;
  $('#btn-errores').onclick = exportarErrores;
  show('#resultado');
  guardarLocal();
}
function gauge(id, pct, color){
  const c = document.getElementById(id), ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  const cx=110, cy=110, r=86;
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--border'); ctx.lineWidth=14;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*2.5); ctx.stroke();
  ctx.strokeStyle=color; ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*(0.5+2*(pct/100))); ctx.stroke();
  ctx.fillStyle=color; ctx.font='bold 22px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(pct.toFixed(1)+'%', cx, cy);
}
function mostrarRevision(mode){
  const list = $('#lista-revision'); list.innerHTML='';
  preguntas.forEach((q,i)=>{
    const correcta = ans[i]===q.respuesta;
    if(mode==='w' && correcta) return;
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<div class="muted" style="margin-bottom:6px">#${i+1} · <span class="badge">${q.categoria||'General'}</span></div>
      <div style="font-weight:800;margin-bottom:6px">${q.pregunta}</div>`;
    ['A','B','C','D'].forEach(k=>{
      const ok = k===q.respuesta, marcado = ans[i]===k;
      const line = document.createElement('div'); line.style.margin='2px 0';
      line.textContent = `${ok?'✅':marcado?'✗':'•'} ${k}) ${q.opciones[k]}`;
      line.style.color = ok? 'var(--success)' : (marcado? 'var(--danger)':'inherit');
      card.appendChild(line);
    });
    if(q.explicacion){ const ex = document.createElement('div'); ex.className='question'; ex.style.marginTop='8px'; ex.innerHTML = `<strong>💡 Explicación:</strong><br>${q.explicacion}`; card.appendChild(ex); }
    if(notas[i]){ const n = document.createElement('div'); n.className='badge'; n.style.marginTop='8px'; n.textContent='📝 ' + notas[i]; card.appendChild(n); }
    list.appendChild(card);
  });
  show('#revision');
}

// ===== Refuerzo + Flashcards =====
let fl_i=0, fl_flip=false, fl_scores={};
function mostrarRefuerzo(){
  $('#resumen-ref').textContent = `${incorrectas.length} preguntas`;
  const cats = [...new Set(incorrectas.map(q=>q.categoria||'General'))];
  $('#cat-ref').innerHTML = `<option value="">Todas</option>` + cats.map(c=>`<option>${c}</option>`).join('');
  renderRef(incorrectas);
  fl_i=0; fl_flip=false; renderFlash();
  $('#ref-volver').onclick = ()=>show('#resultado');
  $('#buscar-ref').oninput = filtrarRef;
  $('#cat-ref').onchange = filtrarRef;
  $('#fl-prev').onclick = ()=>{ if(fl_i>0){ fl_i--; fl_flip=false; renderFlash(); } };
  $('#fl-next').onclick = ()=>{ if(fl_i<incorrectas.length-1){ fl_i++; fl_flip=false; renderFlash(); } };
  $('#fl-vol').onclick = ()=>{ fl_flip=!fl_flip; renderFlash(); };
  $$('#refuerzo .btn[data-score]').forEach(b=> b.onclick = ()=>{ fl_scores[fl_i]=parseInt(b.dataset.score,10); toast('Guardado'); renderFlash(); });
  show('#refuerzo');
}
function renderRef(arr){
  const cont = $('#lista-ref'); cont.innerHTML='';
  arr.forEach(q=>{
    const el = document.createElement('div'); el.className='question';
    el.innerHTML = `<div style="font-weight:800;margin-bottom:4px">${q.pregunta}</div>`;
    ['A','B','C','D'].forEach(k=>{
      const line = document.createElement('div'); line.style.margin='2px 0'; line.textContent = `${k}) ${q.opciones[k]}`;
      if(k===q.respuesta){ line.style.color='var(--success)'; line.style.fontWeight='800'; }
      el.appendChild(line);
    });
    if(q.explicacion){ const b = document.createElement('div'); b.className='badge'; b.style.marginTop='6px'; b.textContent = '💡 ' + q.explicacion; el.appendChild(b); }
    cont.appendChild(el);
  });
}
function filtrarRef(){
  const t=$('#buscar-ref').value.toLowerCase(), c=$('#cat-ref').value;
  const arr = incorrectas.filter(q=>{
    const txt = (q.pregunta+' '+Object.values(q.opciones).join(' ')).toLowerCase();
    const okT = !t || txt.includes(t);
    const okC = !c || (q.categoria||'General')===c;
    return okT && okC;
  });
  renderRef(arr);
}
function renderFlash(){
  if(!incorrectas.length){ $('#flash').textContent='Nada que repasar'; $('#flash-stats').textContent=''; return; }
  const q = incorrectas[fl_i];
  $('#flash').textContent = fl_flip ? `✅ ${q.respuesta}) ${q.opciones[q.respuesta]}\n\n${q.explicacion? '💡 '+q.explicacion:''}` : q.pregunta;
  const estud = Object.keys(fl_scores).length;
  const prom = estud? (Object.values(fl_scores).reduce((a,b)=>a+b,0)/estud).toFixed(1) : '—';
  $('#flash-stats').textContent = `Tarjeta ${fl_i+1}/${incorrectas.length} · Estudiadas: ${estud} · Dificultad media: ${prom}`;
}

// ===== Stats =====
function mostrarStats(){
  const T=preguntas.length, C=preguntas.filter((q,i)=>ans[i]===q.respuesta).length, I=T-C;
  $('#stat-t').textContent=T; $('#stat-c').textContent=C; $('#stat-i').textContent=I;
  const byCat={};
  preguntas.forEach((q,i)=>{ const c=q.categoria||'General'; byCat[c]??={t:0,c:0}; byCat[c].t++; if(ans[i]===q.respuesta) byCat[c].c++; });
  const cont = $('#stats-cat'); cont.innerHTML='';
  Object.entries(byCat).sort((a,b)=>b[1].t-a[1].t).forEach(([cat,st])=>{
    const pct=(st.c/st.t)*100;
    const div=document.createElement('div'); div.className='grid';
    div.innerHTML = `<div class="row space-between"><strong>${cat}</strong><span>${st.c}/${st.t} (${pct.toFixed(1)}%)</span></div>
                     <div class="progress"><div style="width:${pct.toFixed(1)}%"></div></div>`;
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
  const data={idx, ans, rest, nombre, quizHash, flags, notas, cfg};
  localStorage.setItem(sk(), JSON.stringify(data));
  if(!silent) toast('Progreso guardado');
}
function cargarLocal(){
  try{
    for(const [k,v] of Object.entries(localStorage)){
      try{
        const d = JSON.parse(v);
        if(d && d.quizHash && d.nombre===nombre){ idx=d.idx||0; ans=d.ans||[]; rest=d.rest||(cfg.minutos*60); flags=d.flags||new Array(preguntas.length).fill(false); notas=d.notas||{}; cfg=d.cfg||cfg; toast('Progreso cargado'); break; }
      }catch{}
    }
  }catch{}
}
function exportarJSON(){ dl('progreso_simv3.json', JSON.stringify({idx,ans,rest,nombre,quizHash,flags,notas,cfg}, null, 2), 'application/json'); }
function importarJSON(e){
  const f=e.target.files[0]; if(!f) return;
  const R=new FileReader();
  R.onload=()=>{
    try{
      const d=JSON.parse(R.result);
      if(d.quizHash!==quizHash) return alert('Progreso no corresponde a este banco');
      idx=d.idx||0; ans=d.ans||[]; rest=d.rest||cfg.minutos*60; flags=d.flags||new Array(preguntas.length).fill(false); notas=d.notas||{}; cfg=d.cfg||cfg;
      pintarPregunta(); toast('Progreso importado');
    }catch{ alert('JSON inválido'); }
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
  cfg.minutos = Math.max(5, parseInt($('#cfg-min').value||'30',10));
  cfg.cantidad= Math.max(0, parseInt($('#cfg-n').value||'0',10));
  cfg.sq      = $('#cfg-sq').checked;
  cfg.so      = $('#cfg-so').checked;
  toast('Configuración guardada');
};

// ===== Exportar errores =====
function exportarErrores(){
  if(!incorrectas.length) return toast('Nada que exportar');
  const H=['pregunta','opcion_a','opcion_b','opcion_c','opcion_d','respuesta','categoria','explicacion'];
  const lines=[H.join(',')];
  incorrectas.forEach(q=>{
    const esc = v => '\"'+(v||'').replaceAll('\"','\"\"')+'\"';
    lines.push([q.pregunta,q.opciones.A,q.opciones.B,q.opciones.C,q.opciones.D,q.respuesta,q.categoria||'General',q.explicacion||''].map(esc).join(','));
  });
  dl('errores_refuerzo.csv', lines.join('\\n'), 'text/csv');
}

// ===== Reset =====
function reset(){ idx=0; ans=[]; incorrectas=[]; rest=cfg.minutos*60; fl_scores={}; fl_flip=false; fl_i=0; pintarPregunta?.(); startTimer?.(); show('#examen'); }

// ===== Plantilla =====
function descargarPlantilla(){
  const H=['pregunta','opcion_a','opcion_b','opcion_c','opcion_d','respuesta','categoria','explicacion'];
  const rows=[H.join(','),
  '¿Cuál drena el encéfalo?,Vena yugular interna,Vena basílica,Vena femoral,Vena esplénica,A,Anatomía,Principal vía de drenaje del encéfalo y cuello profundo.',
  '¿Dónde se sintetiza ATP principalmente?,Mitocondria,Cloroplasto,Lisosoma,Ribosoma,A,Bioquímica,Fosforilación oxidativa.',
  'Par craneal del olfato,I,II,III,IV,A,Neuro,Sensorial: I par craneal.'
  ];
  dl('plantilla_simulador.csv', rows.join('\\n'), 'text/csv');
}
