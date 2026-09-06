import{p as rt}from"./chunk-JWPE2WC7-DFFk8gG0.js";import{F as b,bf as G,g as nt,a2 as it,b2 as st,a3 as ot,b3 as lt,a6 as ct,b5 as ut,b as d,aE as B,a5 as gt,s as dt,b1 as pt,aO as ht,E as ft,t as mt,S as vt}from"./mermaid.core--qMhBnvg.js";import{p as xt}from"./cynefin-VYW2F7L2-BJ8938y7.js";import{d as J}from"./arc-DIOg-10X.js";import{o as St}from"./ordinal-Cboi1Yqb.js";import"./index-DuXIZ0xf.js";import"./init-Gi6I4Gst.js";function yt(t,n){return n<t?-1:n>t?1:n>=t?0:NaN}function wt(t){return t}function At(){var t=wt,n=yt,y=null,T=b(0),l=b(G),p=b(0);function i(e){var r,o=(e=nt(e)).length,h,w,$=0,f=new Array(o),s=new Array(o),D=+T.apply(this,arguments),z=Math.min(G,Math.max(-G,l.apply(this,arguments)-D)),k,F=Math.min(Math.abs(z)/o,p.apply(this,arguments)),u=F*(z<0?-1:1),A;for(r=0;r<o;++r)(A=s[f[r]=r]=+t(e[r],r,e))>0&&($+=A);for(n!=null?f.sort(function(M,m){return n(s[M],s[m])}):y!=null&&f.sort(function(M,m){return y(e[M],e[m])}),r=0,w=$?(z-o*u)/$:0;r<o;++r,D=k)h=f[r],A=s[h],k=D+(A>0?A*w:0)+u,s[h]={data:e[h],index:r,value:A,startAngle:D,endAngle:k,padAngle:F};return s}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:b(+e),i):t},i.sortValues=function(e){return arguments.length?(n=e,y=null,i):n},i.sort=function(e){return arguments.length?(y=e,n=null,i):y},i.startAngle=function(e){return arguments.length?(T=typeof e=="function"?e:b(+e),i):T},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:b(+e),i):l},i.padAngle=function(e){return arguments.length?(p=typeof e=="function"?e:b(+e),i):p},i}var Ct=vt.pie,I={sections:new Map,showData:!1},W=I.sections,V=I.showData,$t=structuredClone(Ct),Dt=d(()=>structuredClone($t),"getConfig"),bt=d(()=>{W=new Map,V=I.showData,mt()},"clear"),Tt=d(({label:t,value:n})=>{if(n<0)throw new Error(`"${t}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);W.has(t)||(W.set(t,n),B.debug(`added new section: ${t}, with value: ${n}`))},"addSection"),kt=d(()=>W,"getSections"),Et=d(t=>{V=t},"setShowData"),zt=d(()=>V,"getShowData"),K={getConfig:Dt,clear:bt,setDiagramTitle:ut,getDiagramTitle:ct,setAccTitle:lt,getAccTitle:ot,setAccDescription:st,getAccDescription:it,addSection:Tt,getSections:kt,setShowData:Et,getShowData:zt},Mt=d((t,n)=>{rt(t,n),n.setShowData(t.showData),t.sections.map(n.addSection)},"populateDb"),Rt={parse:d(async t=>{const n=await xt("pie",t);B.debug(n),Mt(n,K)},"parse")},Ft=d(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),Lt=Ft,Ot=d(t=>{const n=[...t.values()].reduce((l,p)=>l+p,0),y=[...t.entries()].map(([l,p])=>({label:l,value:p})).filter(l=>l.value/n*100>=1);return At().value(l=>l.value).sort(null)(y)},"createPieArcs"),Wt=d((t,n,y,T)=>{var q;B.debug(`rendering pie chart
`+t);const l=T.db,p=gt(),i=dt(l.getConfig(),p.pie),e=40,r=18,o=4,h=450,w=h,$=pt(n),f=$.append("g");f.attr("transform","translate("+w/2+","+h/2+")");const{themeVariables:s}=p;let[D]=ht(s.pieOuterStrokeWidth);D??(D=2);const z=i.legendPosition,k=i.textPosition,F=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,u=Math.min(w,h)/2-e,A=J().innerRadius(F*u).outerRadius(u),M=J().innerRadius(u*k).outerRadius(u*k),m=f.append("g");m.append("circle").attr("cx",0).attr("cy",0).attr("r",u+D/2).attr("class","pieOuterCircle");const L=l.getSections(),Q=Ot(L),Y=[s.pie1,s.pie2,s.pie3,s.pie4,s.pie5,s.pie6,s.pie7,s.pie8,s.pie9,s.pie10,s.pie11,s.pie12];let H=0;L.forEach(a=>{H+=a});const U=Q.filter(a=>(a.data.value/H*100).toFixed(0)!=="0"),N=St(Y).domain([...L.keys()]);m.selectAll("mySlices").data(U).enter().append("path").attr("d",A).attr("fill",a=>N(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),m.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/H*100).toFixed(0)+"%").attr("transform",a=>"translate("+M.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const tt=f.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),R=[...L.entries()].map(([a,c])=>({label:a,value:c})),C=f.selectAll(".legend").data(R).enter().append("g").attr("class","legend");C.append("rect").attr("width",r).attr("height",r).style("fill",a=>N(a.label)).style("stroke",a=>N(a.label)),C.append("text").attr("x",r+o).attr("y",r-o).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const E=Math.max(...C.selectAll("text").nodes().map(a=>(a==null?void 0:a.getBoundingClientRect().width)??0));let O=h,P=w+e;const g=r+o,_=R.length*g;switch(z){case"center":C.attr("transform",(a,c)=>{const v=g*R.length/2,x=-E/2-(r+o),S=c*g-v;return"translate("+x+","+S+")"});break;case"top":O+=_,C.attr("transform",(a,c)=>{const v=u,x=-E/2-(r+o),S=c*g-v;return`translate(${x}, ${S})`}),m.attr("transform",()=>`translate(0, ${_+g})`);break;case"bottom":O+=_,C.attr("transform",(a,c)=>{const v=-u-g,x=-E/2-(r+o),S=c*g-v;return"translate("+x+","+S+")"});break;case"left":P+=r+o+E,C.attr("transform",(a,c)=>{const v=g*R.length/2,x=-u-(r+o),S=c*g-v;return"translate("+x+","+S+")"}),m.attr("transform",()=>`translate(${E+r+o}, 0)`);break;case"right":default:P+=r+o+E,C.attr("transform",(a,c)=>{const v=g*R.length/2,x=12*r,S=c*g-v;return"translate("+x+","+S+")"});break}const j=((q=tt.node())==null?void 0:q.getBoundingClientRect().width)??0,et=w/2-j/2,at=w/2+j/2,X=Math.min(0,et),Z=Math.max(P,at)-X;$.attr("viewBox",`${X} 0 ${Z} ${O}`),ft($,O,Z,i.useMaxWidth)},"draw"),Ht={draw:Wt},jt={parser:Rt,db:K,renderer:Ht,styles:Lt};export{jt as diagram};
