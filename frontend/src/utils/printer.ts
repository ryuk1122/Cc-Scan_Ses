/**
 * printer.ts — Utilidades para impresora Bluetooth ESC/POS.
 * Usa react-native-bluetooth-escpos-printer.
 *
 * Flujo:
 *   1. listarImpresoras()  → escanea dispositivos BT pareados
 *   2. guardarImpresora()  → conecta y guarda MAC + nombre en AsyncStorage
 *   3. imprimirTicket()    → reconecta si es necesario e imprime
 */
import {
  BluetoothManager,
  BluetoothEscposPrinter,
} from 'react-native-bluetooth-escpos-printer';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Impresora = { name: string; address: string };

const PRINTER_MAC_KEY  = 'printer_mac';
const PRINTER_NAME_KEY = 'printer_name';

// ─── helpers internos ──────────────────────────────────────────────────────

/** Verifica si el BT está habilitado y lo activa si no lo está */
async function asegurarBluetooth(): Promise<void> {
  try {
    await BluetoothManager.enableBluetooth();
  } catch {
    // En algunos dispositivos falla silenciosamente si ya está activo
  }
}

/** Intenta conectar a una MAC dada; lanza error si falla */
async function conectarA(mac: string): Promise<void> {
  await BluetoothManager.connect(mac);
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Devuelve la lista de impresoras Bluetooth ya pareadas en el teléfono.
 * También incluye dispositivos encontrados en el último scan si los hay.
 */
export async function listarImpresoras(): Promise<Impresora[]> {
  await asegurarBluetooth();

  let raw: any;
  try {
    raw = await BluetoothManager.scanDevices();
  } catch (e: any) {
    throw new Error(`No se pudo escanear dispositivos Bluetooth: ${e?.message ?? e}`);
  }

  // scanDevices devuelve { paired?: string, found?: string }
  const paired: Impresora[] = JSON.parse(raw?.paired || '[]');
  const found: Impresora[]  = JSON.parse(raw?.found  || '[]');

  // Combinar sin duplicados por dirección MAC
  const map = new Map<string, Impresora>();
  [...paired, ...found].forEach((d) => {
    if (d?.address) map.set(d.address, d);
  });

  return Array.from(map.values());
}

/**
 * Conecta a la impresora indicada y persiste su MAC + nombre.
 * Lanza error si la conexión falla.
 */
export async function guardarImpresora(address: string, name: string): Promise<void> {
  await asegurarBluetooth();
  await conectarA(address);                           // lanza si no puede conectar
  await AsyncStorage.setItem(PRINTER_MAC_KEY, address);
  await AsyncStorage.setItem(PRINTER_NAME_KEY, name);
}

/**
 * Intenta conectar a la impresora previamente guardada.
 * @returns true si logró conectar, false si no hay impresora guardada o falla.
 */
export async function conectarImpresoraGuardada(): Promise<boolean> {
  try {
    const mac = await AsyncStorage.getItem(PRINTER_MAC_KEY);
    if (!mac) return false;
    await asegurarBluetooth();
    await conectarA(mac);
    return true;
  } catch {
    return false;
  }
}

// ─── formato del ticket ────────────────────────────────────────────────────

const SEPARATOR = '================================';
const SEPARATOR_THIN = '--------------------------------';

/**
 * Imprime un ticket de asistencia en la impresora Bluetooth conectada.
 * Requiere que la conexión ya esté establecida (conectarImpresoraGuardada).
 */
export async function imprimirTicket(params: {
  nombre: string;
  cargo: string;
  municipio: string;
}): Promise<void> {
  const { nombre, cargo, municipio } = params;

  const C = BluetoothEscposPrinter.ALIGN.CENTER;
  const L = BluetoothEscposPrinter.ALIGN.LEFT;

  // ── Cabecera ──
  await BluetoothEscposPrinter.printerAlign(C);
  await BluetoothEscposPrinter.printText('SES\n', {
    widthtimes: 2,
    heighttimes: 2,
    fonttype: 1,
  });
  await BluetoothEscposPrinter.printText(
    'Sindicato de Educadores\nde Santander\n',
    { fonttype: 1 }
  );
  await BluetoothEscposPrinter.printText(`${SEPARATOR}\n`, {});

  // ── Datos del asistente ──
  await BluetoothEscposPrinter.printerAlign(L);

  await BluetoothEscposPrinter.printText(
    nombre ? `Nombre:\n${nombre}\n` : 'Nombre: ---\n',
    { fonttype: 1 }
  );

  await BluetoothEscposPrinter.printText(
    cargo ? `Cargo:\n${cargo}\n` : 'Cargo: ---\n',
    {}
  );

  await BluetoothEscposPrinter.printText(
    municipio ? `Municipio:\n${municipio}\n` : 'Municipio: ---\n',
    {}
  );

  // ── Pie ──
  await BluetoothEscposPrinter.printerAlign(C);
  await BluetoothEscposPrinter.printText(`${SEPARATOR_THIN}\n`, {});

  const now = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
  await BluetoothEscposPrinter.printText(`${now}\n`, {});
  await BluetoothEscposPrinter.printText('** BIENVENIDO **\n', { widthtimes: 1, heighttimes: 1, fonttype: 1 });

  // Avance de papel y corte
  await BluetoothEscposPrinter.printText('\n\n\n', {});
  try {
    await BluetoothEscposPrinter.cutOnePoint();
  } catch {
    // Algunas impresoras no soportan corte automático
  }
}
