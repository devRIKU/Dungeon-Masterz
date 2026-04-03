
export class SoundManager {
  private ctx: AudioContext | null = null;
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceNodes: AudioNode[] = [];

  private reverbBuffer: AudioBuffer | null = null;

  private async init() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      
      // Pre-cache reverb buffer if not exists
      if (!this.reverbBuffer && this.ctx) {
        const length = this.ctx.sampleRate * 2.5;
        this.reverbBuffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        for (let i = 0; i < 2; i++) {
          const data = this.reverbBuffer.getChannelData(i);
          for (let j = 0; j < length; j++) {
            data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 3);
          }
        }
      }
    } catch (e) {
      console.warn('AudioContext failed to initialize', e);
    }
  }

  private createReverb() {
    if (!this.ctx || !this.reverbBuffer) return null;
    const convolver = this.ctx.createConvolver();
    convolver.buffer = this.reverbBuffer;
    return convolver;
  }

  private async playTone(freq: number, type: OscillatorType, duration: number, volume: number = 0.1) {
    try {
      await this.init();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Silently fail to not block UI
    }
  }

  playClick() {
    this.playTone(800, 'sine', 0.1, 0.05);
  }

  playHover() {
    this.playTone(400, 'sine', 0.05, 0.02);
  }

  playSuccess() {
    this.playTone(600, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(800, 'sine', 0.2, 0.1), 100);
  }

  playError() {
    this.playTone(200, 'sawtooth', 0.3, 0.05);
  }

  playMessage() {
    this.playTone(1000, 'sine', 0.05, 0.05);
    setTimeout(() => this.playTone(1200, 'sine', 0.1, 0.05), 50);
  }

  async playVoice(base64Data: string) {
    try {
      await this.init();
      if (!this.ctx || this.ctx.state !== 'running') return;

      // Stop existing voice
      this.stopVoice();

      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Gemini TTS returns 16-bit PCM at 24kHz
      const pcmData = new Int16Array(bytes.buffer);
      const audioBuffer = this.ctx.createBuffer(1, pcmData.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0;
      }
      
      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 0.97;

      const master = this.ctx.createGain();
      master.gain.value = 0.92;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      filter.Q.value = 1.4;

      const resonant = this.ctx.createBiquadFilter();
      resonant.type = 'bandpass';
      resonant.frequency.value = 640;
      resonant.Q.value = 0.9;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -28;
      compressor.knee.value = 14;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.24;

      const reverb = this.createReverb();
      const reverbGain = this.ctx.createGain();
      reverbGain.gain.value = 0.26;

      const delay = this.ctx.createDelay();
      delay.delayTime.value = 0.19;
      const delayGain = this.ctx.createGain();
      delayGain.gain.value = 0.18;

      const tremolo = this.ctx.createGain();
      tremolo.gain.value = 0.78;
      const lfo = this.ctx.createOscillator();
      const lfoDepth = this.ctx.createGain();
      lfo.frequency.value = 4.2;
      lfoDepth.gain.value = 0.08;

      source.connect(filter);
      filter.connect(resonant);
      resonant.connect(compressor);
      compressor.connect(tremolo);
      tremolo.connect(master);
      master.connect(this.ctx.destination);

      lfo.connect(lfoDepth);
      lfoDepth.connect(tremolo.gain);
      lfo.start();

      if (reverb) {
        compressor.connect(reverb);
        reverb.connect(reverbGain);
        reverbGain.connect(master);
      }

      compressor.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(master);
      delayGain.connect(delay);
      
      source.onended = () => {
        if (this.voiceSource === source) {
          try {
            lfo.stop();
          } catch (e) {
            // no-op
          }
          this.voiceSource = null;
          this.voiceNodes = [];
        }
      };
      
      this.voiceSource = source;
      this.voiceNodes = [master, filter, resonant, compressor, reverbGain, delay, delayGain, tremolo, lfo, lfoDepth];
      source.start();
    } catch (e) {
      console.error('Failed to play voice audio', e);
    }
  }

  stopVoice() {
    if (this.voiceSource) {
      try {
        this.voiceSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.voiceSource = null;
    }
    this.voiceNodes = [];
  }
}

export const soundManager = new SoundManager();
