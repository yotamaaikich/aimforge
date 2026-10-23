import test from 'node:test';
import assert from 'node:assert/strict';
import { AimSession } from '../docs/engine.js';
const create=(options={})=>new AimSession({random:()=>.5,...options});
test('hits, misses, reaction time and streak scoring are recorded',()=>{
  const s=create();s.start(1000);let t=s.target;
  const hit=s.shoot(t.x,t.y,1200);assert.equal(hit.type,'hit');assert.equal(s.hits,1);assert.equal(s.averageReaction,200);assert.ok(s.score>0);
  s.shoot(-50,-50,1300);assert.equal(s.accuracy,50);assert.equal(s.streak,0);assert.equal(s.bestStreak,1);assert.equal(s.shots,2);
});
test('a click at the deadline cannot add a hit',()=>{
  const s=create();s.start(0);const t=s.target;assert.equal(s.shoot(t.x,t.y,30000),null);assert.equal(s.state,'finished');assert.equal(s.hits,0);assert.equal(s.result().duration,30);
});
test('a paused session excludes wall-clock pause time',()=>{
  const s=create();s.start(0);s.pause(5000);s.step(20000);assert.equal(s.elapsed,5000);s.resume(25000);s.step(26000);assert.equal(s.elapsed,6000);s.step(50000);assert.equal(s.state,'finished');
});
test('reflex waits for a target, penalizes early shots and counts expiration',()=>{
  const s=create({mode:'reflex'});s.start(0);assert.equal(s.target,null);assert.equal(s.shoot(400,160,100).type,'miss');
  s.step(1100);assert.ok(s.target);s.step(2300);assert.equal(s.expired,1);assert.equal(s.target,null);assert.equal(s.events[0].type,'expired');
  s.step(3200);const t=s.target;s.shoot(t.x,t.y,3400);assert.equal(s.hits,1);assert.equal(s.averageReaction,200);assert.equal(s.accuracy,50);
});
test('tracking requires a held pointer inside the target and includes idle time',()=>{
  const s=create({mode:'tracking'});s.start(0);s.target.vx=0;s.target.vy=0;s.pointer={x:s.target.x,y:s.target.y,held:false};s.step(1000);assert.equal(s.trackedMs,0);
  s.pointer.held=true;s.step(2000);assert.equal(s.trackedMs,1000);assert.equal(s.accuracy,50);assert.equal(s.score,100);s.pointer.held=false;s.step(30000);assert.equal(s.result().accuracy,3.3);
});
test('tracking stays within bounds through delayed frames and resizing',()=>{
  const s=create({mode:'tracking',difficulty:'hard'});s.start(0);s.step(15000);assert.ok(s.target.x>=s.target.radius);assert.ok(s.target.x<=s.width-s.target.radius);assert.ok(s.target.y>=s.target.radius);s.resize(400,200);s.step(16000);assert.ok(s.target.x<=400-s.target.radius);assert.ok(s.target.y<=200-s.target.radius);
});
test('only completed sessions produce a result',()=>{
  const s=create();assert.equal(s.result(),null);s.start(0);s.step(100);assert.equal(s.result(),null);s.pause(200);assert.equal(s.result(),null);s.resume(300);s.step(40000);assert.equal(s.result().accuracy,0);
});
test('invalid session options are rejected',()=>{assert.throws(()=>create({mode:'invalid'}));assert.throws(()=>create({duration:1}));});
