import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, AppState, Platform, StyleSheet, Text, TouchableOpacity, View, type ViewProps } from 'react-native';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { MrzConsensus } from '../utils/mrzValidation';
import { ScannerSession } from '../utils/scannerSession';

type Event<T> = { nativeEvent: T };
type Props = ViewProps & {
  active: boolean;
  onMrz: (raw: string) => Promise<boolean>;
  onBarcode: (raw: string, type: string) => boolean;
};
type NativeProps = ViewProps & {
  ref?: React.Ref<LocalCameraRef>;
  active: boolean; torch: boolean; session: number;
  onObservation: (event: Event<{ raw: string; frameId: number; generation: number; session: number }>) => void;
  onStatus: (event: Event<{ code: string; message: string; session: number }>) => void;
  onBarcode: (event: Event<{ raw: string; type: string; session: number }>) => void;
  onError: (event: Event<{ message: string; session: number }>) => void;
};
type Timing = { samples: number; p50Ms: number; p95Ms: number; maxMs: number; under150Percent: number };
export type LocalCameraRef = {
  capture: () => Promise<string>;
  getPerformance: () => Promise<Record<string, Timing>>;
  resetPerformance: () => Promise<void>;
  recordConfirmation: (firstFrameId: number) => Promise<void>;
};
export const localScannerAvailable = Platform.OS === 'android' && !!requireOptionalNativeModule('CedulaScanner');
const NativeCamera = localScannerAvailable
  ? requireNativeView<NativeProps>('CedulaScanner') : null;

export const LocalCedulaCamera = forwardRef<LocalCameraRef, Props>(function LocalCedulaCamera(
  { active, onMrz, onBarcode, children, ...props }, ref,
) {
  const native = useRef<LocalCameraRef | null>(null);
  const consensus = useRef(new MrzConsensus());
  const generation = useRef(-1);
  const session = useRef(new ScannerSession());
  const acceptedRaw = useRef('');
  const missingSince = useRef(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [torch, setTorch] = useState(false);
  const [message, setMessage] = useState('Presenta el reverso de la cédula');
  const [failed, setFailed] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const running = active && foreground && !failed;
  session.current.setActive(running);
  useImperativeHandle(ref, () => ({ capture: () => {
    if (!native.current || !foreground || failed) return Promise.reject(new Error('La cámara no está lista'));
    return native.current.capture();
  }, getPerformance: () => native.current?.getPerformance() || Promise.resolve({}),
     resetPerformance: () => native.current?.resetPerformance() || Promise.resolve(),
     recordConfirmation: (firstFrameId: number) => native.current?.recordConfirmation(firstFrameId) || Promise.resolve(),
  }), [foreground, failed]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      consensus.current.reset(); setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => { consensus.current.reset(); }, [running]);
  const observe = useCallback(({ nativeEvent: event }: Event<{ raw: string; frameId: number; generation: number; session: number }>) => {
    if (!session.current.accepts(event.session)) return;
    if (generation.current !== event.generation) {
      consensus.current.reset(); generation.current = event.generation;
    }
    const result = consensus.current.observe(event.raw, event.frameId);
    if (result) {
      const raw = result.lines.join('\n');
      consensus.current.reset();
      missingSince.current = 0;
      if (acceptedRaw.current === raw) { setMessage('Retira la cédula para continuar'); return; }
      acceptedRaw.current = raw;
      void native.current?.recordConfirmation(result.firstFrameId).catch(() => {});
      setMessage('Lectura confirmada');
      void onMrz(raw).then(accepted => {
        if (!accepted && acceptedRaw.current === raw) acceptedRaw.current = '';
      }).catch(() => { if (acceptedRaw.current === raw) acceptedRaw.current = ''; });
    } else setMessage('Comprobando las tres líneas; mantén la cédula quieta');
  }, [onMrz]);
  const showPerformance = async () => {
    try {
      const data = await native.current?.getPerformance();
      const line = (name: string, key: string) => {
        const sample = data?.[key];
        return sample ? `${name}: p95 ${sample.p95Ms.toFixed(0)} ms · ${sample.samples} muestras · ${sample.under150Percent.toFixed(0)}% bajo 150 ms`
          : `${name}: sin muestras`;
      };
      Alert.alert('Velocidad medida en este teléfono', [
        line('Código decodificado', 'barcodeDetectedMs'), line('Detección de MRZ', 'mrzDetectedMs'),
        line('Confirmación de 3 lecturas', 'mrzConfirmationMs'),
        'p95: el 95% de las muestras tarda ese tiempo o menos. Desde cuadros analizados; no incluye enfocar, guardar ni sincronizar.',
      ].join('\n\n'), [{ text: 'Cerrar' }, { text: 'Reiniciar medición', onPress: () => { void native.current?.resetPerformance().catch(() => {}); } }]);
    } catch { Alert.alert('Medición no disponible', 'Vuelve a abrir la cámara para medir.'); }
  };
  if (!NativeCamera) return null;
  return <View {...props}>
    <NativeCamera key={cameraKey} ref={native} style={StyleSheet.absoluteFill}
      active={running} session={session.current.id} torch={torch && foreground} onObservation={observe}
      onStatus={({ nativeEvent: event }) => {
        if (!session.current.accepts(event.session)) return;
        if (event.code !== 'reading') consensus.current.reset();
        if (event.code === 'searching') {
          if (!missingSince.current) missingSince.current = Date.now();
          if (Date.now() - missingSince.current > 700) acceptedRaw.current = '';
        } else missingSince.current = 0;
        setMessage(event.message);
      }}
      onBarcode={({ nativeEvent: event }) => {
        if (session.current.accepts(event.session)) consensus.current.observeBarcode(onBarcode(event.raw, event.type));
      }}
      onError={({ nativeEvent: event }) => {
        if (!session.current.accepts(event.session)) return;
        consensus.current.reset(); setFailed(true); setMessage(event.message);
      }} />
    {children}
    <View style={styles.feedback}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.controls}>
        <TouchableOpacity accessibilityLabel="Medir velocidad del lector" onPress={() => { void showPerformance(); }} style={styles.button}>
          <Text style={styles.label}>Velocidad</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="Cambiar iluminación" onPress={() => setTorch(value => !value)} style={styles.button}>
          <Text style={styles.label}>{torch ? 'Apagar luz' : 'Encender luz'}</Text>
        </TouchableOpacity>
        {failed && <TouchableOpacity onPress={() => { setFailed(false); setCameraKey(value => value+1); }} style={styles.button}>
          <Text style={styles.label}>Reintentar cámara</Text>
        </TouchableOpacity>}
      </View>
    </View>
  </View>;
});
const styles = StyleSheet.create({
  feedback: { position: 'absolute', top: 12, left: 12, right: 12, alignItems: 'center', gap: 8 },
  message: { backgroundColor: 'rgba(0,0,0,0.78)', padding: 10, borderRadius: 8, color: '#fff', textAlign: 'center' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  button: { padding: 9, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.7)' },
  label: { color: '#fff' },
});
