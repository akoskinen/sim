////////////////////////////////////////////////////////////
// engine.js
////////////////////////////////////////////////////////////

// --- Canvas and Context ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Track Setup Variables ---
let currentTrackKey = 'speedTrack';               // default track key
let currentTrack    = trackConfigs[currentTrackKey]; // default track object

let buoyPixels = [];
let buoys = [];
let timingLine = { x1: 0, y1: 0, x2: 0, y2: 0 };

// We'll store the offset used to center the track on the canvas.
let trackOffset = { x: 0, y: 0 };

// --- Compute Buoys Function ---
function computeBuoys(){
  buoyPixels = currentTrack.buoys.map(b => ({
	x: b.x * currentTrack.scale,
	y: canvas.height - (b.y * currentTrack.scale)
  }));
  
  const centroid = buoyPixels.reduce((sum, b) => ({
	x: sum.x + b.x,
	y: sum.y + b.y
  }), { x: 0, y: 0 });
  centroid.x /= buoyPixels.length;
  centroid.y /= buoyPixels.length;
  
  trackOffset.x = canvas.width / 2 - centroid.x;
  trackOffset.y = canvas.height / 2 - centroid.y;
  
  buoys = buoyPixels.map(b => ({
	x: b.x + trackOffset.x,
	y: b.y + trackOffset.y
  }));
  
  timingLine = currentTrack.computeTimingLine(buoys, canvas);
}

// --- Audio Setup ---
const windAudio      = document.getElementById('windAudio');
const musicAudio     = document.getElementById('musicAudio');
const boomStopAudio  = document.getElementById('boomStopAudio');
const collisionAudio = document.getElementById('collisionAudio');

musicAudio.loop = true;

function fadeOutMusic(){
  if (!musicAudio.paused) {
	let volume = 1.0;
	const fadeTime = 5000;
	const steps = 50;
	const fadeInterval = fadeTime / steps;
	const step = 1 / steps;
	function doFade(){
	  volume = Math.max(0, volume - step);
	  musicAudio.volume = volume;
	  if (volume > 0) {
		setTimeout(doFade, fadeInterval);
	  } else {
		musicAudio.pause();
		musicAudio.currentTime = 0;
		musicAudio.volume = 1.0;
	  }
	}
	doFade();
  }
}

function enableAudio(){
  windAudio.play().catch(err => console.warn("Wind audio failed", err));
  document.removeEventListener('keydown', enableAudio);
}
document.addEventListener('keydown', enableAudio, { once: true });

// --- Canvas Resize ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  computeBuoys();
}
window.addEventListener('resize', resizeCanvas);

// --- Track Selector Handling ---
const trackRadios = document.querySelectorAll('input[name="track"]');
trackRadios.forEach(radio => {
  radio.addEventListener('change', function(){
	if (this.checked) {
	  currentTrackKey = this.value;            // e.g. 'speedTrack'
	  currentTrack    = trackConfigs[currentTrackKey];
	  computeBuoys();
	  // If we switch tracks, we might clear or reload the ideal line
	  idealLineData = null;
	}
  });
});

// --- Game Physics and Control Variables ---
const maxSpeed = 100;
const timeToMaxSpeed = 18;
const accelRate = maxSpeed / timeToMaxSpeed;
const decelRate = 12.333;
const speedConversion = 0.6;
const speedScale = 0.837;

const BANK_ANGLE_MAX = 55;
const bankRate0to30 = 40;
const bankRate30to55 = 10;
let bankAngleDeg = 0;
const bankDecay = 0.9;

function updateBankAngle(dt){
  let targetSign = 0;
  if (keys['ArrowLeft'])  targetSign = -1;
  if (keys['ArrowRight']) targetSign =  1;
  
  if (targetSign !== 0) {
	let currentMag = Math.abs(bankAngleDeg);
	let sign = Math.sign(bankAngleDeg);
	if (sign === 0) sign = targetSign;
	if (sign !== targetSign) {
	  currentMag = 0;
	  bankAngleDeg = 0;
	  sign = targetSign;
	}
	let rate = (currentMag < 30) ? bankRate0to30 : bankRate30to55;
	currentMag += rate * dt;
	if (currentMag > BANK_ANGLE_MAX) currentMag = BANK_ANGLE_MAX;
	bankAngleDeg = sign * currentMag;
  } else {
	if (Math.abs(bankAngleDeg) < 0.5) {
	  bankAngleDeg = 0;
	} else {
	  const decayPow = Math.pow(bankDecay, 60 * dt);
	  bankAngleDeg *= decayPow;
	  if (Math.abs(bankAngleDeg) < 0.05) bankAngleDeg = 0;
	}
  }
}

// --- Turn Radius Interpolation ---
const baseline30Data = [
  { speed:10, radius:10 },
  { speed:15, radius:15 },
  { speed:30, radius:30 },
  { speed:40, radius:65 },
  { speed:60, radius:80 }
];
const reduceData = [
  { speed:10, factor:0.85 },
  { speed:15, factor:0.82 },
  { speed:30, factor:0.83 },
  { speed:40, factor:0.85 },
  { speed:60, factor:0.90 }
];

function interpPiecewise(table, spd){
  let s = Math.max(10, Math.min(60, spd));
  for (let i = 1; i < table.length; i++){
	const prev = table[i-1];
	const cur  = table[i];
	if (s >= prev.speed && s <= cur.speed) {
	  const span   = cur.speed - prev.speed;
	  const ratio  = (s - prev.speed) / span;
	  const valPrev= (prev.radius !== undefined) ? prev.radius : prev.factor;
	  const valCur = (cur.radius  !== undefined) ? cur.radius  : cur.factor;
	  return valPrev + (valCur - valPrev) * ratio;
	}
  }
  if (s <= table[0].speed) {
	return (table[0].radius !== undefined) ? table[0].radius : table[0].factor;
  }
  const last = table[table.length - 1];
  return (last.radius !== undefined) ? last.radius : last.factor;
}

function getTurnRadius(speedKmh, angleDeg){
  let ang = Math.max(0, Math.min(55, angleDeg));
  const base30    = interpPiecewise(baseline30Data, speedKmh);
  const factorMax = interpPiecewise(reduceData, speedKmh);
  const radiusAt50= base30 * factorMax;
  
  if (ang < 30) {
	const frac = ang / 30;
	const bigVal = 5000;
	return bigVal + frac * (base30 - bigVal);
  } else if (ang <= 50) {
	const frac = (ang - 30) / 20;
	return base30 + frac * (radiusAt50 - base30);
  } else {
	return radiusAt50;
  }
}

const turnGain  = 15;
const lowFactor = 0.02084;

// --- Movement & Telemetry ---
let heading = 0;
let speed   = 0;
const pos   = { x: 0, y: 0 };
let oldPos  = { x: 0, y: 0 };

let lapActive     = false;
let lapStartTime  = 0;
let currentLapTime= 0;

const laps = [];

let distanceTraveled = 0;
let topSpeedKmh      = 0;
let minSpeedKmh      = Infinity;
let sumSpeeds        = 0;
let frameCount       = 0;
let lastPosTelemetry = { x: 0, y: 0 };

let collidedThisLap  = false;
let penaltySeconds   = 0;

// --- Ghost Data & Functions ---
let ghostData    = null;
let recordedGhost= [];

// Convert pixel coords to track meters.
function pixelToTrackMeters(px, py) {
  const localX = px - trackOffset.x;
  const localY = py - trackOffset.y;
  const metersX= localX / currentTrack.scale;
  const metersY= (canvas.height - localY) / currentTrack.scale;
  return { x: metersX, y: metersY };
}

// Convert track meters back to pixel coords.
function trackMetersToPixel(mx, my) {
  const localX = mx * currentTrack.scale;
  const localY = canvas.height - (my * currentTrack.scale);
  return {
	x: localX + trackOffset.x,
	y: localY + trackOffset.y
  };
}

// Record each frame's position in "meters" instead of pixels.
function recordGhostData(timeSec){
  if (!lapActive) return;
  const trackM = pixelToTrackMeters(pos.x, pos.y);
  recordedGhost.push({
	time: timeSec,
	x: trackM.x,
	y: trackM.y,
	heading
  });
}

function getGhostPosition(t){
  if (!ghostData || !ghostData.frames || ghostData.frames.length === 0) return null;
  const frames = ghostData.frames;
  
  for (let i = 1; i < frames.length; i++){
	const prev = frames[i-1];
	const cur  = frames[i];
	if (prev.time <= t && cur.time >= t) {
	  const ratio = (t - prev.time) / (cur.time - prev.time);
	  const x = prev.x + ratio * (cur.x - prev.x);
	  const y = prev.y + ratio * (cur.y - prev.y);
	  const h = prev.heading + ratio * (cur.heading - prev.heading);
	  return { x, y, heading: h };
	}
  }
  const last = frames[frames.length - 1];
  if (t > last.time) return last;
  return frames[0];
}

function drawGhost(timeSec){
  if (!lapActive || !ghostData || !ghostData.frames) return;
  const gp = getGhostPosition(timeSec);
  if (!gp) return;
  
  const { x: px, y: py } = trackMetersToPixel(gp.x, gp.y);
  
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.translate(px, py);
  ctx.rotate(gp.heading - Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, 12.5);
  ctx.bezierCurveTo(4, 7.5, 4, -7.5, 0, -12.5);
  ctx.bezierCurveTo(-4, -7.5, -4, 7.5, 0, 12.5);
  ctx.closePath();
  ctx.fillStyle = '#ff88ff';
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1.0;
}

function startLap(){
  lapStartTime     = performance.now();
  currentLapTime   = 0;
  lapActive        = true;
  
  distanceTraveled = 0;
  topSpeedKmh      = 0;
  minSpeedKmh      = Infinity;
  sumSpeeds        = 0;
  frameCount       = 0;
  
  lastPosTelemetry.x = pos.x;
  lastPosTelemetry.y = pos.y;
  
  collidedThisLap = false;
  penaltySeconds  = 0;
  
  recordedGhost   = [];
}

function finalizeLap(){
  lapActive = false;
  const rawTime = (performance.now() - lapStartTime) / 1000;
  currentLapTime = rawTime + penaltySeconds;
  
  const avgSpeedKmh = (frameCount > 0) ? (sumSpeeds / frameCount) : 0;
  laps.unshift({
	topSpeed: topSpeedKmh,
	minSpeed: (minSpeedKmh === Infinity ? 0 : minSpeedKmh),
	avgSpeed: avgSpeedKmh,
	distance: distanceTraveled,
	finalTime: currentLapTime
  });
  if (laps.length > 4) laps.pop();
  
  ghostData = {
	trackKey: currentTrackKey,
	frames: recordedGhost.slice()
  };
}

// --- Input Handling ---
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;

  // Toggle 'P' to show/hide the ideal line
  if (e.key === 'p' || e.key === 'P') {
	showIdealLine = !showIdealLine;
	// If we haven't loaded the line yet, load it now
	if (showIdealLine && !idealLineData) {
	  loadIdealLineForCurrentTrack();
	}
  }
});

document.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// --- Intersection & Timing Line Crossing ---
function orientation(p, q, r){
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function linesIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2){
  const p1 = { x: ax1, y: ay1 }, p2 = { x: ax2, y: ay2 };
  const p3 = { x: bx1, y: by1 }, p4 = { x: bx2, y: by2 };
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) {
	if ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)) return true;
  }
  return false;
}

function checkLapCrossing(){
  if (pos.x === 0 || pos.x === canvas.width || pos.y === 0 || pos.y === canvas.height) {
	return;
  }
  if (linesIntersect(oldPos.x, oldPos.y, pos.x, pos.y,
					 timingLine.x1, timingLine.y1,
					 timingLine.x2, timingLine.y2)) {
	if (!lapActive) {
	  startLap();
	  musicAudio.volume = 1.0;
	  musicAudio.currentTime = 0;
	  musicAudio.play().catch(err => console.warn("Music play fail", err));
	} else {
	  finalizeLap();
	  boomStopAudio.currentTime = 0;
	  boomStopAudio.play().catch(err => console.warn("Boom stop fail", err));
	  fadeOutMusic();
	}
  }
}

// --- Collision Detection with Buoys ---
function checkBuoyCollisions(){
  if (!lapActive || collidedThisLap) return;
  
  for (const b of buoys) {
	const dx = b.x - pos.x;
	const dy = b.y - pos.y;
	const dist = Math.hypot(dx, dy);
	if (dist < 12) {
	  penaltySeconds += 10;
	  collidedThisLap = true;
	  collisionAudio.currentTime = 0;
	  collisionAudio.play().catch(err => console.warn("Collision audio fail", err));
	  break;
	}
  }
}

// --- Update Function ---
function update(dt){
  oldPos.x = pos.x;
  oldPos.y = pos.y;
  
  if (keys['ArrowUp']) {
	speed += accelRate * dt;
  }
  if (keys['ArrowDown']) {
	speed -= decelRate * dt;
  }
  speed = Math.max(0, Math.min(maxSpeed, speed));
  
  updateBankAngle(dt);
  
  const speedKmh = speed * speedConversion;
  const radius   = getTurnRadius(speedKmh, Math.abs(bankAngleDeg));
  const angleRad = (bankAngleDeg * Math.PI) / 180;
  const turnFactor = Math.sign(bankAngleDeg) * (Math.abs(angleRad) * turnGain) * ((1 / radius) + lowFactor);
  heading += turnFactor * dt;
  
  pos.x += speed * speedScale * dt * Math.cos(heading);
  pos.y += speed * speedScale * dt * Math.sin(heading);
  
  let wrapped = false;
  if (pos.x > canvas.width) { pos.x = 0; wrapped = true; }
  else if (pos.x < 0)       { pos.x = canvas.width; wrapped = true; }
  if (pos.y > canvas.height){ pos.y = 0; wrapped = true; }
  else if (pos.y < 0)       { pos.y = canvas.height; wrapped = true; }
  
  windAudio.volume = speed / maxSpeed;
  
  document.getElementById('speedDisplay').innerText = `Speed: ${speedKmh.toFixed(1)} km/h`;
  document.getElementById('bankAngleDisplay').innerText = `Bank: ${bankAngleDeg.toFixed(0)}°`;
  
  if (!wrapped) {
	checkLapCrossing();
  }
  
  if (lapActive) {
	if (speedKmh > topSpeedKmh) topSpeedKmh = speedKmh;
	if (speedKmh < minSpeedKmh) minSpeedKmh = speedKmh;
	sumSpeeds += speedKmh;
	frameCount++;
	
	const dx = pos.x - lastPosTelemetry.x;
	const dy = pos.y - lastPosTelemetry.y;
	const distPx = Math.hypot(dx, dy);
	const distM  = distPx / currentTrack.scale;
	distanceTraveled += distM;
	lastPosTelemetry.x = pos.x;
	lastPosTelemetry.y = pos.y;
	
	checkBuoyCollisions();
	
	const rawSec = (performance.now() - lapStartTime) / 1000;
	recordGhostData(rawSec);
	
	const totalSec = rawSec + penaltySeconds;
	if (penaltySeconds > 0 && collidedThisLap) {
	  document.getElementById('lapTimeDisplay').innerText = `Laptime: ${totalSec.toFixed(2)} (- ${penaltySeconds}s penalty!)`;
	} else {
	  document.getElementById('lapTimeDisplay').innerText = `Laptime: ${totalSec.toFixed(2)}`;
	}
  } else {
	if (penaltySeconds > 0) {
	  document.getElementById('lapTimeDisplay').innerText = `Laptime: ${currentLapTime.toFixed(2)} (- ${penaltySeconds}s penalty!)`;
	} else {
	  document.getElementById('lapTimeDisplay').innerText = `Laptime: ${currentLapTime.toFixed(2)}`;
	}
  }
}

// --- Wake Trail and Drawing ---
let wakeTrail = [];
function totalTrailDistance(trail){
  let d = 0;
  for (let i = 1; i < trail.length; i++){
	d += Math.hypot(trail[i].x - trail[i-1].x, trail[i].y - trail[i-1].y);
  }
  return d;
}

function drawWake(){
  if (wakeTrail.length < 2) return;
  for (let i = 1; i < wakeTrail.length; i++){
	const t = i / wakeTrail.length;
	const alpha = t;
	ctx.beginPath();
	ctx.moveTo(wakeTrail[i-1].x, wakeTrail[i-1].y);
	ctx.lineTo(wakeTrail[i].x, wakeTrail[i].y);
	ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
	ctx.lineWidth = 2;
	ctx.stroke();
  }
}

function drawTrack(){
  buoys.forEach(b => {
	ctx.beginPath();
	ctx.arc(b.x, b.y, 8, 0, 2 * Math.PI);
	ctx.fillStyle = '#FFFF00';
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = '#fff';
	ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(timingLine.x1, timingLine.y1);
  ctx.lineTo(timingLine.x2, timingLine.y2);
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTelemetry(){
  ctx.save();
  ctx.font = '14px monospace';
  ctx.fillStyle = '#fff';
  let x = 20, y = 50;
  ctx.fillText('Telemetry:', x, y);
  y += 20;
  laps.forEach((lap, idx) => {
	ctx.fillText(`Lap ${idx+1}:`, x, y); y += 18;
	ctx.fillText(`  Time:   ${lap.finalTime.toFixed(2)} s`, x, y); y += 18;
	ctx.fillText(`  Dist:   ${lap.distance.toFixed(1)} m`, x, y); y += 18;
	ctx.fillText(`  TopSpd: ${lap.topSpeed.toFixed(1)} km/h`, x, y); y += 18;
	ctx.fillText(`  MinSpd: ${lap.minSpeed.toFixed(1)} km/h`, x, y); y += 18;
	ctx.fillText(`  AvgSpd: ${lap.avgSpeed.toFixed(1)} km/h`, x, y); y += 24;
  });
  ctx.restore();
}

function drawRacer(){
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(heading - Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, 12.5);
  ctx.bezierCurveTo(4, 7.5, 4, -7.5, 0, -12.5);
  ctx.bezierCurveTo(-4, -7.5, -4, 7.5, 0, 12.5);
  ctx.closePath();
  ctx.fillStyle = '#00ccff';
  ctx.fill();
  ctx.restore();
}

function drawGhostFrame(){
  if (lapActive) {
	const rawSec = (performance.now() - lapStartTime) / 1000;
	drawGhost(rawSec);
  } else {
	drawGhost(currentLapTime);
  }
}

// --- Ideal Line Toggle ---
let showIdealLine  = false;
let idealLineData  = null;

async function loadIdealLineForCurrentTrack() {
  // example: "Dubai Track" => "Dubai%20Track_ideal.json"
  const safeName = encodeURIComponent(currentTrack.name) + '_ideal.json';
  try {
	const response = await fetch(safeName);
	if (!response.ok) {
	  console.warn(`Failed to load ideal line file: ${safeName}`);
	  return;
	}
	const data = await response.json();
	idealLineData = data;
	console.log('Ideal line loaded:', data);
  } catch (err) {
	console.error('Error loading ideal line:', err);
  }
}

function drawIdealLine() {
  if (!showIdealLine) return;
  if (!idealLineData || !idealLineData.frames) return;

  // If the ideal line is for a different track, we could skip or warn:
  if (idealLineData.trackKey && idealLineData.trackKey !== currentTrackKey) {
	// console.warn('Ideal line trackKey does not match currentTrackKey!');
	return;
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 255, 0, 0.25)';
  ctx.lineWidth   = 1;
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < idealLineData.frames.length; i++) {
	const frame = idealLineData.frames[i];
	const { x: px, y: py } = trackMetersToPixel(frame.x, frame.y);
	
	if (!started) {
	  ctx.moveTo(px, py);
	  started = true;
	} else {
	  ctx.lineTo(px, py);
	}
  }
  ctx.stroke();
  ctx.restore();
}

// --- Main Game Loop ---
let lastTimestamp = 0;
function gameLoop(timestamp){
  if (!lastTimestamp) lastTimestamp = timestamp;
  let dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  if (dt > 0.1) dt = 0.1;
  
  wakeTrail.push({ x: pos.x, y: pos.y });
  const targetWakeLength = (speed / maxSpeed) * 200;
  while (wakeTrail.length > 1 && totalTrailDistance(wakeTrail) > targetWakeLength) {
	wakeTrail.shift();
  }
  
  update(dt);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // If you have a background map, draw it here:
  // drawBackgroundMap();

  drawIdealLine(); // <-- Draw the green path if toggled on
  
  drawTrack();
  drawWake();
  drawGhostFrame();
  drawRacer();
  drawTelemetry();
  
  requestAnimationFrame(gameLoop);
}

// --- Ghost Export / Import Controls ---
const exportGhostBtn  = document.getElementById('exportGhostBtn');
const importGhostFile = document.getElementById('importGhostFile');
const clearGhostBtn   = document.getElementById('clearGhostBtn');

exportGhostBtn.addEventListener('click', () => {
  if (!ghostData || !ghostData.frames || ghostData.frames.length === 0) {
	alert('No ghost data to export yet. Complete at least one lap.');
	return;
  }
  const jsonData = JSON.stringify(ghostData);
  const blob = new Blob([jsonData], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lapData.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

importGhostFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
	const text = await file.text();
	const imported = JSON.parse(text);

	if (!imported.frames || !Array.isArray(imported.frames)) {
	  alert('Invalid ghost data file.');
	  return;
	}
	if (imported.trackKey && trackConfigs[imported.trackKey]) {
	  currentTrackKey = imported.trackKey;
	  currentTrack    = trackConfigs[currentTrackKey];
	  computeBuoys();
	} else if (imported.trackKey) {
	  alert(`Warning: The ghost uses trackKey "${imported.trackKey}" which doesn't exist here!`);
	}

	ghostData = imported;
	alert('Ghost data imported successfully! It will appear on your next lap.');
  } catch (err) {
	alert('Failed to read file: ' + err);
  }
});

clearGhostBtn.addEventListener('click', () => {
  ghostData = null;
  alert('Ghost data cleared.');
});

// --- Initialization ---
resizeCanvas();  
pos.x = canvas.width / 2;
pos.y = canvas.height / 2;
requestAnimationFrame(gameLoop);
