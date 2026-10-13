import {test} from 'node:test';import assert from 'node:assert/strict';import {distanceKm,score,pickRounds,Game} from '../src/game.ts';
test('Haversine: identidad, simetría y Buenos Aires–Córdoba',()=>{const a={lat:-34.6037,lng:-58.3816},b={lat:-31.4167,lng:-64.1833};assert.equal(distanceKm(a,a),0);assert.ok(Math.abs(distanceKm(a,b)-distanceKm(b,a))<1e-8);assert.ok(distanceKm(a,b)>640&&distanceKm(a,b)<660);assert.ok(Number.isFinite(distanceKm({lat:0,lng:0},{lat:0,lng:180})));});
test('Puntaje acotado y decreciente, con validación',()=>{assert.equal(score(0),5000);assert.ok(score(100)>score(500));assert.ok(score(20000)>=0);assert.throws(()=>score(-1));assert.throws(()=>score(NaN));});
test('Cinco destinos sin repeticiones',()=>{const r=pickRounds();assert.equal(r.length,5);assert.equal(new Set(r.map(p=>p.name)).size,5);});
test('Una apuesta por ronda, 5 rondas y total máximo',()=>{const g=new Game();g.submit();assert.equal(g.results.length,0);g.next();assert.equal(g.index,0);for(let i=0;i<5;i++){g.target=g.rounds[i];g.guess=g.target;g.submit();g.submit();assert.equal(g.results.length,i+1);if(i<4){g.next();assert.equal(g.guess,null);assert.equal(g.target,null);}}assert.equal(g.total,25000);assert.equal(g.finished,true);g.next();assert.equal(g.index,4);});
test('El reloj empieza con un panorama disponible y dura dos minutos',()=>{
 const g=new Game();g.startTimer(1000);assert.equal(g.deadline,null);
 g.target=g.rounds[0];g.startTimer(1000);assert.equal(g.remainingSeconds(1000),120);
 g.startTimer(2000);assert.equal(g.deadline,121000);
 assert.equal(g.remainingSeconds(120999),1);assert.equal(g.expire(120999),false);
 assert.equal(g.expire(121000),true);assert.equal(g.remainingSeconds(121000),0);
 assert.deepEqual(g.results[0],{name:g.rounds[0].name,distance:null,points:0,timedOut:true});
 g.expire(122000);g.guess=g.target;g.submit(122000);assert.equal(g.results.length,1);
});
test('Una apuesta marcada sin confirmar o confirmada tarde vale cero',()=>{
 const g=new Game();g.target=g.rounds[0];g.guess=g.target;g.startTimer(0);
 g.submit(120000);assert.equal(g.total,0);assert.equal(g.results[0].timedOut,true);
 assert.equal(g.results[0].distance,0);
 g.next();assert.equal(g.deadline,null);assert.equal(g.guess,null);
 g.target=g.rounds[1];g.guess=g.target;g.startTimer(150000);g.submit(269999);
 assert.equal(g.results[1].points,5000);assert.equal(g.results[1].timedOut,false);
 assert.equal(g.expire(270000),false);assert.equal(g.results.length,2);
});
test('Cinco rondas sin apostar terminan la partida con cero puntos',()=>{
 const g=new Game();for(let i=0;i<5;i++){
  g.target=g.rounds[i];g.startTimer(i*120000);assert.equal(g.expire((i+1)*120000),true);
  if(i<4)g.next();
 }
 assert.equal(g.finished,true);assert.equal(g.total,0);assert.equal(g.results.length,5);
});
