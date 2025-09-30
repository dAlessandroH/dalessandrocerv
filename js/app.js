// ------------------- UTILIDADES BÁSICAS -------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const toast = (msg) => { const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 1800); };

// CSV parser simple (comillas y comas)
function parseCSV(text){
  const rows=[]; let cur=''; let row=[]; let inQuotes=false; 
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'){
      if(inQuotes && n==='"'){cur+='"'; i++;}
      else inQuotes=!inQuotes;
    }else if(c===',' && !inQuotes){ row.push(cur); cur=''; }
    else if((c==='\n' || c==='\r') && !inQuotes){ if(cur!==''||row.length){row.push(cur);} if(row.length){rows.push(row); row=[];} cur=''; }
    else{ cur+=c; }
  }
  if(cur!==''||row.length){row.push(cur); rows.push(row);} 
  return rows;
}

function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]] } return arr; }
function hashQuiz(qs){ return qs.map(q=>q.pregunta+q.respuesta).join('|').split('').reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0) }

// ------------------- ESTADO GLOBAL -------------------
let preguntas = [];
let indice = 0;
let respuestasUsuario = [];
let tiempoLimite = 30*60; // 30 min
let tiempoRestante = tiempoLimite;
let timerId = null;
let nombreArchivo = 'preguntas.csv';
let incorrectas = [];
let erroresPorCategoria = {};
let quizHash = null;

// ------------------- CARGA CSV -------------------
$('#file-input').addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  nombreArchivo = file.name;
  const text = await file.text();
  const rows = parseCSV(text);
  if(!rows.length){ alert('El CSV está vacío.'); return; }
  const headers = rows[0].map(h=>h.trim().toLowerCase());
  const req = ['pregunta','opcion_a','opcion_b','opcion_c','opcion_d','respuesta'];
  if(!req.every(r=>headers.includes(r))){ alert('Formato incorrecto. Encabezados requeridos: '+req.join(', ')); return; }
  const idx = (k)=> headers.indexOf(k);
  const out = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i]; if(r.length===1 && r[0].trim()==='') continue;
    out.push({
      pregunta: r[idx('pregunta')]?.trim()||'',
      opciones: {
        A: r[idx('opcion_a')]?.trim()||'',
        B: r[idx('opcion_b')]?.trim()||'',
        C: r[idx('opcion_c')]?.trim()||'',
        D: r[idx('opcion_d')]?.trim()||''
      },
      respuesta: (r[idx('respuesta')]||'').trim().toUpperCase(),
      categoria: (idx('categoria')>-1? r[idx('categoria')] : 'General')?.trim()||'General',
      explicacion: (idx('explicacion')>-1? r[idx('explicacion')] : '')?.trim()||''
    });
  }
  if(!out.length){ alert('No se encontraron preguntas.'); return; }
  preguntas = shuffle(out);
  quizHash = hashQuiz(preguntas);
  cargarProgresoLocal();
  reiniciar();
  iniciarExamen();
});

// ------------------- NAVEGACIÓN DE PANTALLAS -------------------
function show(id){ ['#pantalla-inicio','#pantalla-examen','#pantalla-resultado','#pantalla-revision','#pantalla-refuerzo','#pantalla-estadisticas'].forEach(s=>$(s).classList.add('hidden')); $(id).classList.remove('hidden'); }

function iniciarExamen(){
  $('#archivo-nombre').textContent = nombreArchivo;
  $('#btn-anterior').addEventListener('click', anteriorPregunta);
  $('#btn-siguiente').addEventListener('click', siguientePregunta);
  $('#btn-finalizar').addEventListener('click', finalizarExamen);
  $('#btn-guardar').addEventListener('click', guardarProgresoLocal);
  $('#btn-cambiar-archivo').addEventListener('click', () => $('#file-input').click());
  document.addEventListener('keydown', keyNav);
  actualizarUIPregunta();
  iniciarTemporizador();
  show('#pantalla-examen');
}

function keyNav(e){
  if($('#pantalla-examen').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if(k==='arrowleft'){ anteriorPregunta(); }
  if(k==='arrowright' || k==='enter'){ siguientePregunta(); }
  if(['a','b','c','d'].includes(k)){ seleccionarOpcion(k.toUpperCase()); }
}

function iniciarTemporizador(){ 
  clearInterval(timerId); 
  tiempoRestante = tiempoRestante ?? tiempoLimite; 
  timerId = setInterval(()=>{
    tiempoRestante--; 
    if(tiempoRestante<0){ 
      clearInterval(timerId); 
      alert('¡Se agotó el tiempo!'); 
      finalizarExamen(); 
      return; 
    }
    const m = Math.floor(tiempoRestante/60).toString().padStart(2,'0');
    const s = (tiempoRestante%60).toString().padStart(2,'0');
    $('#timer').textContent = `${m}:${s}`;
  },1000);
}

function actualizarUIPregunta(){
  const q = preguntas[indice];
  $('#progreso-texto').textContent = `Pregunta ${indice+1} de ${preguntas.length}`;
  const pct = ((indice)/preguntas.length)*100; $('#progreso-bar').style.width = `${pct}%`;
  $('#texto-pregunta').textContent = `${indice+1}. ${q.pregunta}`;
  const cont = $('#opciones'); cont.innerHTML='';
  const opciones = ['A','B','C','D'];
  opciones.forEach(op=>{
    const div=document.createElement('label'); div.className='option';
    div.innerHTML = `<input type="radio" name="op" value="${op}"><div><span class='pill'>${op})</span> ${q.opciones[op]||''}</div>`;
    div.onclick = (e)=>{ const inp = div.querySelector('input'); inp.checked=true; seleccionarOpcion(op); };
    cont.appendChild(div);
  });
  // restaurar selección
  const sel = respuestasUsuario[indice]; 
  if(sel){ 
    const r = $$('input[name=op]').find(r=>r.value===sel); 
    if(r) r.checked=true; 
    $('#btn-siguiente').disabled=false; 
  }
  $('#btn-anterior').disabled = indice===0;
  $('#btn-siguiente').disabled = !sel;
}

function seleccionarOpcion(op){ respuestasUsuario[indice]=op; $('#btn-siguiente').disabled=false; }

function anteriorPregunta(){ if(indice>0){ guardarProgresoLocal(true); indice--; actualizarUIPregunta(); } }

function siguientePregunta(){ if(!respuestasUsuario[indice]){ alert('Selecciona una respuesta.'); return; } guardarProgresoLocal(true); indice++; if(indice<preguntas.length){ actualizarUIPregunta(); } else { finalizarExamen(); } }

// ------------------- RESULTADOS -------------------
function finalizarExamen(){ 
  clearInterval(timerId);
  let puntaje=0; incorrectas=[]; erroresPorCategoria={};
  preguntas.forEach((q,i)=>{ 
    if(respuestasUsuario[i]===q.respuesta){ puntaje++; } 
    else { incorrectas.push({ ...q, index:i }); erroresPorCategoria[q.categoria]=(erroresPorCategoria[q.categoria]||0)+1; } 
  });
  // UI
  $('#btn-refuerzo').classList.toggle('hidden', incorrectas.length===0);
  const porcentaje = (puntaje/preguntas.length)*100;
  $('#puntaje').textContent = `Puntaje final: ${puntaje}/${preguntas.length} (${porcentaje.toFixed(1)}%)`;
  const fb = porcentaje>=80? {msg:'¡Excelente! 🎯', color:'var(--exito)'} : porcentaje>=60? {msg:'Buen trabajo ✨', color:'var(--advertencia)'} : {msg:'A reforzar contenidos 📖', color:'var(--acento)'};
  $('#feedback').textContent = fb.msg; $('#feedback').style.color = fb.color;
  dibujarGauge('gauge', porcentaje, fb.color);
  // botones
  $('#btn-revisar').onclick = mostrarRevision;
  $('#btn-refuerzo').onclick = mostrarRefuerzo;
  $('#btn-estadisticas').onclick = mostrarEstadisticas;
  $('#btn-reiniciar').onclick = reiniciar;
  show('#pantalla-resultado');
  guardarProgresoLocal();
}

function dibujarGauge(id, pct, color){ 
  const c=$('#'+id); const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); const cx=100, cy=100, r=80;
  // fondo
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--borde'); ctx.lineWidth=12; ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*2.5); ctx.stroke();
  // progreso
  ctx.strokeStyle=color; ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*0.5,Math.PI*(0.5+2*(pct/100))); ctx.stroke();
  // texto
  ctx.fillStyle=color; ctx.font='bold 22px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(pct.toFixed(1)+'%', cx, cy);
}

// ------------------- REVISIÓN -------------------
function mostrarRevision(){ 
  const list=$('#lista-revision'); list.innerHTML='';
  preguntas.forEach((q,i)=>{
    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`<div class='muted' style='margin-bottom:6px'>Pregunta ${i+1} · <span class='badge'>${q.categoria||'General'}</span></div>
      <div style='font-weight:700;margin-bottom:8px'>${q.pregunta}</div>`;
    ['A','B','C','D'].forEach(op=>{
      const correcto = op===q.respuesta; const marcado = respuestasUsuario[i]===op; const line=document.createElement('div'); line.style.margin='4px 0';
      line.innerHTML = `${correcto? '✅' : marcado? '✗' : '•'} <span class='pill'>${op})</span> ${q.opciones[op]}`;
      line.style.color = correcto? 'var(--exito)': (marcado? 'var(--acento)': 'inherit');
      card.appendChild(line);
    });
    if(q.explicacion){ const ex=document.createElement('div'); ex.className='question'; ex.style.marginTop='8px'; ex.innerHTML = `<strong>💡 Explicación:</strong><br>${q.explicacion}`; card.appendChild(ex); }
    list.appendChild(card);
  });
  show('#pantalla-revision');
}
function volverResultados(){ show('#pantalla-resultado'); }

// ------------------- REFUERZO -------------------
let flashIndex = 0; let mostrandoRespuesta=false; let dificultadMap={};

function mostrarRefuerzo(){ 
  $('#resumen-refuerzo').textContent = `${incorrectas.length} preguntas para repasar`;
  // Filtro categorías
  const sel=$('#filtro-categoria'); const cats=[...new Set(incorrectas.map(q=>q.categoria||'General'))]; sel.innerHTML = `<option value="">Todas</option>` + cats.map(c=>`<option>${c}</option>`).join('');
  renderListaRefuerzo(incorrectas);
  // flashcards
  flashIndex=0; mostrandoRespuesta=false; renderFlashcard();
  show('#pantalla-refuerzo');
}

function filtrarRefuerzo(){ 
  const term=$('#busqueda-refuerzo').value.toLowerCase(); const cat=$('#filtro-categoria').value; 
  const arr=incorrectas.filter(q=>{
    const t = q.pregunta.toLowerCase()+ ' ' + Object.values(q.opciones).join(' ').toLowerCase();
    const okT = t.includes(term);
    const okC = !cat || (q.categoria||'General')===cat; return okT && okC;
  });
  renderListaRefuerzo(arr);
}

function renderListaRefuerzo(arr){ 
  const cont=$('#lista-refuerzo'); cont.innerHTML=''; 
  arr.forEach((q,idx)=>{
    const item=document.createElement('div'); item.className='question';
    item.innerHTML=`<div style='font-weight:700;margin-bottom:6px'>${q.pregunta}</div>`;
    ['A','B','C','D'].forEach(op=>{ 
      const ok= op===q.respuesta; const line=document.createElement('div'); line.style.margin='2px 0';
      line.textContent = `${op}) ${q.opciones[op]}`; if(ok){ line.style.color='var(--exito)'; line.style.fontWeight='700'; }
      item.appendChild(line);
    });
    if(q.explicacion){ const ex=document.createElement('div'); ex.className='badge'; ex.style.marginTop='8px'; ex.textContent='💡 ' + q.explicacion; item.appendChild(ex); }
    cont.appendChild(item);
  });
}

function renderFlashcard(){ 
  if(!incorrectas.length){ $('#flashcard').textContent='¡Nada que repasar!'; $('#stats-flash').textContent=''; return; }
  const q = incorrectas[flashIndex]; document.getElementById('flashcard').dataset.idx = flashIndex;
  if(!mostrandoRespuesta){ $('#flashcard').textContent = q.pregunta; }
  else { const txt = `✅ ${q.respuesta}) ${q.opciones[q.respuesta]}\n\n${q.explicacion? '💡 '+q.explicacion: ''}`; $('#flashcard').textContent = txt; }
  const estudiadas = Object.keys(dificultadMap).length; const prom = Object.values(dificultadMap).reduce((a,b)=>a+b,0)/Math.max(1,estudiadas);
  $('#stats-flash').textContent = `Tarjeta ${flashIndex+1}/${incorrectas.length} · Estudiadas: ${estudiadas} · Dificultad media: ${prom.toFixed(1)}★`;
}
function voltearFlashcard(){ mostrandoRespuesta=!mostrandoRespuesta; renderFlashcard(); }
function anteriorFlash(){ if(flashIndex>0){ flashIndex--; mostrandoRespuesta=false; renderFlashcard(); } }
function siguienteFlash(){ if(flashIndex<incorrectas.length-1){ flashIndex++; mostrandoRespuesta=false; renderFlashcard(); } }
function valorarFlash(n){ const idx = document.getElementById('flashcard').dataset.idx; dificultadMap[idx]=n; toast('Guardado'); }

// ------------------- ESTADÍSTICAS -------------------
function mostrarEstadisticas(){ 
  const total=preguntas.length; 
  const correctas=preguntas.filter((q,i)=>respuestasUsuario[i]===q.respuesta).length; 
  const incorrectasN=total-correctas;
  $('#stat-total').textContent = total; $('#stat-correctas').textContent=correctas; $('#stat-incorrectas').textContent=incorrectasN;
  const cont=$('#stats-categorias'); cont.innerHTML='';
  const porCat={}; 
  preguntas.forEach((q,i)=>{ 
    const c=q.categoria||'General'; 
    porCat[c]??={total:0,ok:0}; 
    porCat[c].total++; 
    if(respuestasUsuario[i]===q.respuesta) porCat[c].ok++; 
  });
  Object.entries(porCat).sort((a,b)=>b[1].total-a[1].total).forEach(([cat,st])=>{
    const pct = st.ok/st.total*100; 
    const bar=`<div class='progress'><div style='width:${pct.toFixed(1)}%'></div></div>`;
    const item=document.createElement('div'); item.className='grid'; 
    item.innerHTML = `<div class='row' style='justify-content:space-between'><strong>${cat}</strong><span>${st.ok}/${st.total} (${pct.toFixed(1)}%)</span></div>${bar}`;
    cont.appendChild(item);
  });
  show('#pantalla-estadisticas');
}

// ------------------- PROGRESO LOCAL -------------------
function storageKey(){ return `simulador:v1:${quizHash}:${nombreArchivo}`; }
function guardarProgresoLocal(silencioso=false){ 
  if(!preguntas.length) return; 
  const data={indice, respuestasUsuario, tiempoRestante, nombreArchivo, quizHash}; 
  localStorage.setItem(storageKey(), JSON.stringify(data)); 
  if(!silencioso) toast('💾 Progreso guardado'); 
}
function cargarProgresoLocal(){ 
  try{ 
    const data = Object.entries(localStorage).map(([k,v])=>{ try{ return JSON.parse(v); }catch{return null; } }).find(d=>d && d.quizHash===quizHash && d.nombreArchivo===nombreArchivo); 
    if(!data) return; 
    indice=data.indice||0; 
    respuestasUsuario = Array.isArray(data.respuestasUsuario)? data.respuestasUsuario: []; 
    tiempoRestante = typeof data.tiempoRestante==='number'? data.tiempoRestante : tiempoLimite; 
    toast('📂 Progreso cargado'); 
  }catch(e){} 
}
function reiniciar(){ 
  indice=0; respuestasUsuario=[]; tiempoRestante=tiempoLimite; incorrectas=[]; erroresPorCategoria={}; dificultadMap={}; mostrandoRespuesta=false; flashIndex=0; 
  show('#pantalla-examen'); actualizarUIPregunta(); iniciarTemporizador(); 
}

// ------------------- FIN -------------------
