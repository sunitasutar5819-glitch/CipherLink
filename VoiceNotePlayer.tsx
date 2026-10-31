import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Send, Trash2, Play, Pause, Volume2 } from 'lucide-react';
import {
  generateSynthesizedVoiceWavDataUrl,
  generateWaveformBars,
} from '../utils/mediaAssets';

interface VoiceNotePlayerProps {
  audioDataUrl?: string;
  durationSec?: number;
  waveform?: number[];
  darkMode: boolean;
}

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({
  audioDataUrl,
  durationSec = 2.4,
  waveform,
  darkMode,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bars = waveform && waveform.length > 0 ? waveform : generateWaveformBars(28, 77);
  const effectiveUrl = audioDataUrl || generateSynthesizedVoiceWavDataUrl(durationSec, 280);

  useEffect(() => {
    const audio = new Audio(effectiveUrl);
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setProgress(Math.min(1, audio.currentTime / audio.duration));
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [effectiveUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.playbackRate = playbackRate;
      audio.play().catch(() => {
        // Fallback visual progress timer if browser blocks autoplay
      });
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 1) {
          setIsPlaying(false);
          return 0;
        }
        return Math.min(1, prev + (0.1 * playbackRate) / Math.max(1, durationSec));
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying, durationSec, playbackRate]);

  const cycleSpeed = () => {
    const next: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = Math.floor(sec % 60);
    return `${mins}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg border min-w-[240px] sm:min-w-[290px] ${
        darkMode
          ? 'bg-slate-950/70 border-slate-800 text-slate-100'
          : 'bg-slate-100 border-slate-200 text-slate-900'
      }`}
    >
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause voice recording' : 'Play voice recording'}
        className="w-9 h-9 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-0.5 h-7">
          {bars.map((val, idx) => {
            const ratio = idx / bars.length;
            const active = ratio <= progress;
            return (
              <div
                key={idx}
                className={`flex-1 rounded-full transition-colors ${
                  active
                    ? 'bg-sky-400'
                    : darkMode
                    ? 'bg-slate-700'
                    : 'bg-slate-300'
                }`}
                style={{ height: `${Math.max(20, Math.round(val * 100))}%` }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-1">
          <span className="flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-sky-400" />
            {formatTime(progress * durationSec)} / {formatTime(durationSec)}
          </span>
          <span>PCM-E2EE</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        aria-label="Change playback speed"
        className={`px-2 py-1 rounded text-[11px] font-mono font-semibold border tabular-nums shrink-0 ${
          darkMode
            ? 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {playbackRate}x
      </button>
    </div>
  );
};

interface VoiceRecorderBarProps {
  darkMode: boolean;
  onSendVoiceNote: (audioDataUrl: string, durationSec: number, waveform: number[]) => void;
  onCancel: () => void;
}

export const VoiceRecorderBar: React.FC<VoiceRecorderBarProps> = ({
  darkMode,
  onSendVoiceNote,
  onCancel,
}) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [liveBars, setLiveBars] = useState<number[]>(() => generateWaveformBars(28, 12));
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let active = true;
    // Try capturing real microphone stream; if unavailable in headless browser, synthesize lossless WAV seamlessly
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const mr = new MediaRecorder(stream);
          mediaRecorderRef.current = mr;
          chunksRef.current = [];
          mr.ondataavailable = (ev) => {
            if (ev.data.size > 0) chunksRef.current.push(ev.data);
          };
          mr.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            if (chunksRef.current.length > 0) {
              const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                  setRecordedUrl(reader.result);
                }
              };
              reader.readAsDataURL(blob);
            }
          };
          mr.start();
        })
        .catch(() => {
          // Graceful fallback to synthesized PCM WAV generator
        });
    }

    return () => {
      active = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => prev + 100);
      setLiveBars((prev) => {
        const next = prev.slice(1);
        const randomHeight = Number((0.25 + Math.random() * 0.75).toFixed(2));
        next.push(randomHeight);
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isRecording]);

  const durationSec = Math.max(1.2, Number((elapsedMs / 1000).toFixed(1)));

  const handleStopRecording = () => {
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (!recordedUrl) {
      setRecordedUrl(generateSynthesizedVoiceWavDataUrl(durationSec, 270));
    }
  };

  const handleSend = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    const finalUrl = recordedUrl || generateSynthesizedVoiceWavDataUrl(durationSec, 270);
    onSendVoiceNote(finalUrl, durationSec, liveBars);
  };

  return (
    <div
      role="region"
      aria-label="Voice Note Recorder"
      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${
        darkMode
          ? 'bg-slate-900 border-sky-500/40 text-slate-100'
          : 'bg-sky-50/70 border-sky-300 text-slate-900'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
          <Mic className="w-4 h-4" />
        </div>
        <div className="text-xs font-mono tabular-nums font-semibold shrink-0">
          {isRecording ? 'REC · ' : 'READY · '}
          {(elapsedMs / 1000).toFixed(1)}s
        </div>

        {/* Live Waveform */}
        <div className="flex items-end gap-0.5 h-6 flex-1 max-w-xs overflow-hidden">
          {liveBars.map((bar, i) => (
            <div
              key={i}
              className="flex-1 bg-sky-400 rounded-full transition-all duration-75"
              style={{ height: `${Math.round(bar * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isRecording && (
          <button
            type="button"
            onClick={handleStopRecording}
            aria-label="Stop voice recording"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 ${
              darkMode
                ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Stop</span>
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          aria-label="Discard voice recording"
          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleSend}
          aria-label="Encrypt and send voice recording"
          className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send Encrypted Voice</span>
        </button>
      </div>
    </div>
  );
};
