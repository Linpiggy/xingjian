/**
 * 语音输入（Web Speech API 识别）与语音播报（speechSynthesis）。
 * 浏览器不支持时按钮自动隐藏；识别结果只作为文本填入输入框，由用户确认后再提交。
 */
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

export function useSpeechSupport() {
  const recognition = useSyncExternalStore(
    noop,
    () => recognitionConstructor() !== null,
    () => false,
  );
  const synthesis = useSyncExternalStore(
    noop,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
  return { recognition, synthesis };
}

export function useSpeechInput(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instance = useRef<Recognition | null>(null);
  const callback = useRef(onText);

  useEffect(() => {
    callback.current = onText;
  }, [onText]);

  useEffect(() => () => instance.current?.abort(), []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError("当前浏览器不支持语音输入");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      let final = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        final = final || event.results[i].isFinal;
      }
      callback.current(text, final);
    };
    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed" ? "麦克风权限被拒绝" : "语音识别中断，请重试",
      );
    };
    recognition.onend = () => setListening(false);
    instance.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    instance.current?.stop();
  }, []);

  return { listening, error, start, stop };
}

export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.05;
    const voice = window.speechSynthesis
      .getVoices()
      .find((item) => item.lang.startsWith("zh"));
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { speaking, speak, stop };
}
