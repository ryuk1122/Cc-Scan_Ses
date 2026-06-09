import {
  BluetoothManager,
  BluetoothEscposPrinter,
} from 'react-native-bluetooth-escpos-printer';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Impresora = { name: string; address: string };

export async function conectarImpresoraGuardada(): Promise<boolean> {
  try {
    const mac = await AsyncStorage.getItem('printer_mac');
    if (!mac) return false;
    await BluetoothManager.connect(mac);
    return true;
  } catch {
    return false;
  }
}

export async function listarImpresoras(): Promise<Impresora[]> {
  await BluetoothManager.enableBluetooth();
  const res = await BluetoothManager.scanDevices();
  return JSON.parse(res?.paired || '[]');
}

export async function guardarImpresora(address: string, name: string): Promise<void> {
  await BluetoothManager.connect(address);
  await AsyncStorage.setItem('printer_mac', address);
  await AsyncStorage.setItem('printer_name', name);
}

export async function imprimirTicket(params: {
  nombre: string;
  cargo: string;
  municipio: string;
}): Promise<void> {
  const { nombre, cargo, municipio } = params;
  const C = BluetoothEscposPrinter.ALIGN.CENTER;
  const L = BluetoothEscposPrinter.ALIGN.LEFT;

  await BluetoothEscposPrinter.printerAlign(C);
  await BluetoothEscposPrinter.printText('SES\n', {
    widthtimes: 2, heighttimes: 2, fonttype: 1,
  });
  await BluetoothEscposPrinter.printText(
    'Sindicato de Educadores de Santander\n', { fonttype: 1 }
  );
  await BluetoothEscposPrinter.printText('--------------------------------\n', {});

  await BluetoothEscposPrinter.printerAlign(L);
  await BluetoothEscposPrinter.printText(`Nombre:    ${nombre}\n`, {});
  await BluetoothEscposPrinter.printText(`Cargo:     ${cargo}\n`, {});
  await BluetoothEscposPrinter.printText(`Municipio: ${municipio}\n`, {});

  await BluetoothEscposPrinter.printerAlign(C);
  await BluetoothEscposPrinter.printText('--------------------------------\n', {});
  await BluetoothEscposPrinter.printText(
    `${new Date().toLocaleString('es-CO')}\n`, {}
  );
  await BluetoothEscposPrinter.printText('\n\n\n', {});
  await BluetoothEscposPrinter.cutOnePoint();
}
