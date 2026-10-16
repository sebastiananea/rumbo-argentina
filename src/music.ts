/** Original procedural ambient loop. No recordings, samples or third-party music. */
export class GameMusic {
 muted=false;
 private context?:AudioContext;
 private output?:GainNode;
 private voices=new Set<OscillatorNode>();
 private timer?:ReturnType<typeof setInterval>;
 private wanted=false;
 private step=0;
 private nextNote=0;
 private readonly visibility=()=>{if(document.hidden)this.stopSound();else if(this.wanted)this.start();};
 constructor(){
  try{this.muted=localStorage.getItem('rumbo-music-muted')==='true';}catch{}
  document.addEventListener('visibilitychange',this.visibility);
 }
 /** Called directly from Play/Next/Unmute to satisfy browser audio policies. */
 unlock(){
  if(this.muted)return;
  try{
   if(!this.context){this.context=new AudioContext();this.output=this.context.createGain();this.output.gain.value=.22;const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1800;this.output.connect(filter);filter.connect(this.context.destination);}
   void this.context.resume().catch(()=>{});
  }catch{/* Audio is optional; an unavailable device must not block the game. */}
 }
 start(){
  this.wanted=true;
  if(this.muted||document.hidden||this.timer)return;
  this.unlock();if(!this.context||!this.output)return;
  this.step=0;this.nextNote=this.context.currentTime+.08;
  const schedule=()=>{
   if(!this.context||this.context.state!=='running')return;
   const melody=[76,79,81,79,74,76,72,74,77,81,79,76,74,72,69,72,76,79,81,84,81,79,76,74,74,79,81,79,76,74,71,74];
   const bass=[48,53,57,55];
   // Keep a short lookahead; hidden tabs never queue a backlog of notes.
   if(this.nextNote<this.context.currentTime)this.nextNote=this.context.currentTime+.05;
   while(this.nextNote<this.context.currentTime+.18){
    const step=this.step%32;
    if(step%4!==3)this.note(melody[step],this.nextNote,.8,.065,'triangle');
    if(step%4===0)this.note(bass[Math.floor(step/8)],this.nextNote,1.3,.09,'sine');
    this.nextNote+=60/84/2;this.step++;
   }
  };
  schedule();this.timer=setInterval(schedule,60);
 }
 private note(midi:number,time:number,duration:number,volume:number,type:OscillatorType){
  const context=this.context!,oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.type=type;oscillator.frequency.value=440*2**((midi-69)/12);
  gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+.035);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
  oscillator.connect(gain);gain.connect(this.output!);this.voices.add(oscillator);
  oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices.delete(oscillator);};
  oscillator.start(time);oscillator.stop(time+duration+.02);
 }
 toggle(){this.muted=!this.muted;try{localStorage.setItem('rumbo-music-muted',String(this.muted));}catch{}if(this.muted)this.stopSound();else{this.unlock();if(this.wanted)this.start();}}
 stop(){this.wanted=false;this.stopSound();}
 private stopSound(){if(this.timer)clearInterval(this.timer);this.timer=undefined;for(const voice of this.voices){try{voice.stop();}catch{}}this.voices.clear();}
 dispose(){this.stop();document.removeEventListener('visibilitychange',this.visibility);void this.context?.close().catch(()=>{});}
}
