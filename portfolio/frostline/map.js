// Draws the Frostline depth and yield maps from the #grid JSON block on the page.
(function(){
  var el=document.getElementById('grid'); if(!el) return;
  var G=JSON.parse(el.textContent), C=G.cells;
  var la=C.map(function(r){return r[0];}), lo=C.map(function(r){return r[1];});
  var la0=Math.min.apply(null,la), la1=Math.max.apply(null,la);
  var lo0=Math.min.apply(null,lo), lo1=Math.max.apply(null,lo);
  var cols=lo1-lo0+1, rows=la1-la0+1;

  function scale(vals){
    var s=vals.slice().sort(function(a,b){return a-b;});
    return function(v){
      var lo=0,hi=s.length;
      while(lo<hi){var m=(lo+hi)>>1; if(s[m]<v) lo=m+1; else hi=m;}
      return s.length>1 ? lo/(s.length-1) : 0.5;
    };
  }
  var STOPS=[[0,28,52,74],[0.3,58,104,140],[0.55,138,156,120],[0.8,224,163,60],[1,247,214,150]];
  function ramp(t){
    t=Math.max(0,Math.min(1,t));
    for(var i=0;i<STOPS.length-1;i++){
      if(t<=STOPS[i+1][0]){
        var a=STOPS[i], b=STOPS[i+1], k=(t-a[0])/(b[0]-a[0]);
        return 'rgb('+Math.round(a[1]+(b[1]-a[1])*k)+','+Math.round(a[2]+(b[2]-a[2])*k)+','+Math.round(a[3]+(b[3]-a[3])*k)+')';
      }
    }
    return 'rgb(247,214,150)';
  }
  function render(cv, idx, out, unit){
    var dpr=Math.min(2,window.devicePixelRatio||1);
    cv.width=360*dpr; cv.height=440*dpr;
    var ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
    var cw=W/cols, ch=H/rows;
    var vals=C.filter(function(r){return r[idx]!=null;}).map(function(r){return r[idx];});
    var pos=scale(vals);
    ctx.clearRect(0,0,W,H);
    C.forEach(function(r){
      if(r[idx]==null) return;
      var x=(r[1]-lo0)*cw, y=(la1-r[0])*ch;
      ctx.fillStyle=ramp(pos(r[idx]));
      ctx.fillRect(Math.floor(x),Math.floor(y),Math.ceil(cw)+1,Math.ceil(ch)+1);
    });
    cv.addEventListener('mousemove',function(ev){
      var b=cv.getBoundingClientRect();
      var cx=lo0+Math.floor((ev.clientX-b.left)/b.width*cols);
      var cy=la1-Math.floor((ev.clientY-b.top)/b.height*rows);
      var hit=null;
      for(var i=0;i<C.length;i++){ if(C[i][0]===cy&&C[i][1]===cx){hit=C[i];break;} }
      if(!hit||hit[idx]==null){ out.textContent='Hover to sample'; return; }
      out.innerHTML=(hit[0]*G.dlat).toFixed(2)+'°N '+Math.abs(hit[1]*G.dlon).toFixed(2)+
        '°W &nbsp; <b>'+hit[idx]+' '+unit+'</b> &nbsp; '+hit[4]+' wells';
    });
    cv.addEventListener('mouseleave',function(){ out.textContent='Hover to sample'; });
  }
  render(document.getElementById('mapD'),2,document.getElementById('readD'),'ft');
  render(document.getElementById('mapY'),3,document.getElementById('readY'),'gpm');
})();
