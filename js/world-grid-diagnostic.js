/* Diagnostic local uniquement : données déjà autorisées, aucune RPC, aucun privilège admin. */
(() => {
 'use strict';
 const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) ||
  /^192\.168\.\d+\.\d+$/.test(location.hostname) || /^10\.\d+\.\d+\.\d+$/.test(location.hostname) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(location.hostname);
 let enabled=false, snapshot=null, testCell=null;
 const container=document.querySelector('.armorique-map-container');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.classList.add('world-grid-diagnostic');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('hidden','');container.append(svg);
 const panel=document.createElement('p');panel.className='world-grid-diagnostic-status';panel.hidden=true;panel.setAttribute('role','status');document.getElementById('armorique-view').append(panel);
 const node=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;};
 function render(){
  svg.replaceChildren();svg.toggleAttribute('hidden',!enabled);panel.hidden=!enabled;if(!enabled)return;
  if(!snapshot){panel.textContent='Diagnostic : découvertes indisponibles — brouillard fermé.';return;}
  const {columns,rows,cells}=snapshot,w=100/columns,h=100/rows;
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
   const known=cells.has(col+','+row),rect=node('rect',{x:col*w,y:row*h,width:w,height:h,class:known?'grid-known':'grid-unknown','data-cell':col+','+row});svg.append(rect);
   svg.append(node('text',{x:(col+.5)*w,y:(row+.58)*h,class:'grid-coordinate'},col+'/'+row));
  }
  const exact=document.getElementById('armorique-known-cells').getAttribute('d');
  svg.append(node('path',{d:exact,class:'grid-exact-boundary'}));
  const marker=document.getElementById('armorique-marker');
  if(marker.dataset.positionReady)svg.append(node('circle',{cx:parseFloat(marker.style.left),cy:parseFloat(marker.style.top),r:.55,class:'grid-own-position'}));
  let status='Grille '+columns+' × '+rows+' ; indices depuis 0. Vert : découvert ; rouge : inconnu ; or : frontière exacte ; cyan : votre domaine.';
  if(testCell){const {column:col,row}=testCell;
   if(col<columns&&row<rows){svg.append(node('rect',{x:col*w,y:row*h,width:w,height:h,class:'grid-test-cell'}));status+=' Cellule de test '+col+'/'+row+' : '+(cells.has(col+','+row)?'DÉCOUVERTE':'INCONNUE')+' ; X '+(col*w)+'..'+((col+1)*w)+' / Y '+(row*h)+'..'+((row+1)*h)+'.';}
  }
  panel.textContent=status+' Coordonnée de test locale, aucun domaine étranger récupéré. Zoomez pour lire les petites étiquettes.';
 }
 const api=Object.freeze({
  enable(options={}){if(!local)return false;const c=options.testCell;testCell=c&&Number.isInteger(c.column)&&Number.isInteger(c.row)&&c.column>=0&&c.row>=0?{column:c.column,row:c.row}:null;enabled=true;render();return true;},
  disable(){enabled=false;testCell=null;render();},
  update(data){snapshot=data?{columns:data.columns,rows:data.rows,cells:new Set(data.cells)}:null;render();}
 });
 window.arvor=window.arvor||{};window.arvor.worldGrid=api;
 new MutationObserver(()=>{if(enabled)render();}).observe(document.getElementById('armorique-marker'),{attributes:true,attributeFilter:['style','data-position-ready']});
 const params=new URLSearchParams(location.search);
 if(local&&params.get('worldGrid')==='1'){
  const match=/^(\d+),(\d+)$/.exec(params.get('testCell')||'');api.enable(match?{testCell:{column:Number(match[1]),row:Number(match[2])}}:{});
 }
})();
