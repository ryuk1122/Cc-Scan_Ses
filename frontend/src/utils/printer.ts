import { PermissionsAndroid, Platform } from "react-native";
import type { Permission } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BluetoothEscposPrinter,
  BluetoothManager,
  BluetoothTscPrinter,
} from "react-native-bluetooth-escpos-printer";

export type Impresora = { name: string; address: string };

export type EscarapelaPrintData = {
  nombre: string;
  cargo?: string;
  municipio?: string;
};

const PRINTER_MAC_KEY = "printer_mac";
const PRINTER_NAME_KEY = "printer_name";

const LABEL_WIDTH_MM = 80;
const LABEL_HEIGHT_MM = 50;
const LABEL_GAP_MM = 3;
const ESC_POS_LINE = "\n\r";
const ESC_POS_DIVIDER = "--------------------------------";
const ESC = "\x1b";

type RawEscposPrinter = typeof BluetoothEscposPrinter & {
  printRawText?: (text: string) => Promise<void>;
};

const escposTextOptions = {
  encoding: "GBK",
  codepage: 0,
  widthtimes: 0,
  heigthtimes: 0,
  fonttype: 0,
};

const escposTitleOptions = {
  encoding: "GBK",
  codepage: 0,
  widthtimes: 1,
  heigthtimes: 1,
  fonttype: 1,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value?: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.,#/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toTitle(value?: string): string {
  return cleanText(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function wrap(value: string, maxChars: number, maxLines: number): string[] {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? word.slice(0, maxChars) : word;
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ["SIN NOMBRE"];
}

async function requestBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;

  const apiLevel = Number(Platform.Version || 0);
  const permissions: Permission[] =
    apiLevel >= 31
      ? [
          "android.permission.BLUETOOTH_SCAN" as Permission,
          "android.permission.BLUETOOTH_CONNECT" as Permission,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied) {
    throw new Error("Activa los permisos de Bluetooth para conectar la impresora.");
  }
}

async function ensureBluetooth(): Promise<void> {
  await requestBluetoothPermissions();
  try {
    await BluetoothManager.enableBluetooth();
  } catch {
    // Algunos dispositivos ya tienen Bluetooth activo y la libreria responde con error.
  }
}

async function connectTo(address: string): Promise<void> {
  await BluetoothManager.connect(address);
  await wait(250);
  const connected = await BluetoothManager.isConnected();
  if (!connected) {
    throw new Error("No se pudo confirmar la conexion con la impresora.");
  }
}

function normalizePrinter(rawValue: unknown): Impresora | null {
  if (!rawValue) return null;
  if (typeof rawValue === "string") {
    try {
      return normalizePrinter(JSON.parse(rawValue));
    } catch {
      return null;
    }
  }
  const value = rawValue as Partial<Impresora>;
  return value.address
    ? {
        address: value.address,
        name: value.name || "Impresora Bluetooth",
      }
    : null;
}

function parsePrinterList(rawValue: unknown): Impresora[] {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue.map(normalizePrinter).filter(Boolean) as Impresora[];
  try {
    const parsed = JSON.parse(String(rawValue));
    return Array.isArray(parsed) ? parsed.map(normalizePrinter).filter(Boolean) as Impresora[] : [];
  } catch {
    return [];
  }
}

export async function listarImpresoras(): Promise<Impresora[]> {
  await ensureBluetooth();

  let raw: any;
  try {
    raw = await BluetoothManager.scanDevices();
  } catch (error: any) {
    throw new Error(`No se pudo buscar impresoras Bluetooth: ${error?.message ?? error}`);
  }

  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw || {};
  const paired = parsePrinterList(parsed.paired);
  const found = parsePrinterList(parsed.found);
  const devices = new Map<string, Impresora>();

  [...paired, ...found].forEach((device) => {
    if (device?.address) {
      devices.set(device.address, {
        address: device.address,
        name: device.name || "Impresora Bluetooth",
      });
    }
  });

  return Array.from(devices.values());
}

export async function guardarImpresora(address: string, name: string): Promise<void> {
  await ensureBluetooth();
  await connectTo(address);
  await AsyncStorage.setItem(PRINTER_MAC_KEY, address);
  await AsyncStorage.setItem(PRINTER_NAME_KEY, `${name || "Impresora Bluetooth"} (${address})`);
}
export async function conectarImpresoraGuardada(): Promise<boolean> {
  try {
    const address = await AsyncStorage.getItem(PRINTER_MAC_KEY);
    if (!address) return false;
    await ensureBluetooth();
    await connectTo(address);
    return true;
  } catch {
    return false;
  }
}

async function imprimirEscarapelaTsc({ nombre, cargo, municipio }: EscarapelaPrintData): Promise<void> {
  const R = BluetoothTscPrinter.ROTATION.ROTATION_0;
  const M = BluetoothTscPrinter.FONTMUL;
  const F = BluetoothTscPrinter.FONTTYPE;

  const nameLines = wrap(nombre, 22, 2);
  const cargoText = cleanText(cargo) || "SIN CARGO";
  const municipioText = cleanText(municipio) || "SIN MUNICIPIO";

  await BluetoothTscPrinter.printLable({
    width: LABEL_WIDTH_MM,
    height: LABEL_HEIGHT_MM,
    gap: LABEL_GAP_MM,
    direction: BluetoothTscPrinter.DIRECTION.FORWARD,
    reference: [0, 0],
    tear: BluetoothTscPrinter.TEAR.ON,
    sound: 0,
    density: BluetoothTscPrinter.DENSITY.DNESITY10,
    speed: BluetoothTscPrinter.PRINT_SPEED.SPEED3,
    text: [
      {
        text: "SES",
        x: 32,
        y: 18,
        fonttype: F.FONT_2,
        rotation: R,
        xscal: M.MUL_2,
        yscal: M.MUL_2,
      },
      {
        text: "ASISTENTE",
        x: 500,
        y: 22,
        fonttype: F.FONT_1,
        rotation: R,
        xscal: M.MUL_1,
        yscal: M.MUL_1,
      },
      ...nameLines.map((line, index) => ({
        text: line,
        x: 32,
        y: 95 + index * 55,
        fonttype: F.FONT_3,
        rotation: R,
        xscal: M.MUL_2,
        yscal: M.MUL_2,
      })),
      {
        text: `CARGO: ${cargoText}`,
        x: 32,
        y: 240,
        fonttype: F.FONT_2,
        rotation: R,
        xscal: M.MUL_1,
        yscal: M.MUL_1,
      },
      {
        text: `MUNICIPIO: ${municipioText}`,
        x: 32,
        y: 305,
        fonttype: F.FONT_2,
        rotation: R,
        xscal: M.MUL_1,
        yscal: M.MUL_1,
      },
    ],
  });
}

async function imprimirEscarapelaEscpos({ nombre, cargo, municipio }: EscarapelaPrintData): Promise<void> {
  const center = BluetoothEscposPrinter.ALIGN.CENTER;
  const left = BluetoothEscposPrinter.ALIGN.LEFT;
  const nameLines = wrap(nombre, 24, 3).map(toTitle);
  const cargoText = toTitle(cargo) || "---";
  const municipioText = toTitle(municipio) || "---";

  await BluetoothEscposPrinter.printerInit();
  await BluetoothEscposPrinter.setBlob(0);
  await BluetoothEscposPrinter.printerAlign(center);
  await BluetoothEscposPrinter.printText(`SES${ESC_POS_LINE}`, escposTitleOptions);
  await BluetoothEscposPrinter.printText(`ESCARAPELA${ESC_POS_LINE}`, escposTextOptions);
  await BluetoothEscposPrinter.printText(`${ESC_POS_DIVIDER}${ESC_POS_LINE}`, escposTextOptions);
  for (const line of nameLines) {
    await BluetoothEscposPrinter.printText(`${line}${ESC_POS_LINE}`, escposTitleOptions);
  }
  await BluetoothEscposPrinter.printText(ESC_POS_LINE, escposTextOptions);
  await BluetoothEscposPrinter.printerAlign(left);
  await BluetoothEscposPrinter.printText(`Cargo: ${cargoText}${ESC_POS_LINE}`, escposTextOptions);
  await BluetoothEscposPrinter.printText(`Municipio: ${municipioText}${ESC_POS_LINE}`, escposTextOptions);
  await BluetoothEscposPrinter.printText(`${ESC_POS_LINE}${ESC_POS_LINE}`, escposTextOptions);
  await BluetoothEscposPrinter.printAndFeed(80);
}

async function imprimirEscarapelaRawEscpos({ nombre, cargo, municipio }: EscarapelaPrintData): Promise<void> {
  const rawPrinter = BluetoothEscposPrinter as RawEscposPrinter;
  if (!rawPrinter.printRawText) {
    throw new Error("RAW_ESC_POS_UNAVAILABLE");
  }

  const nameLines = wrap(nombre, 24, 3).map(toTitle);
  const cargoText = toTitle(cargo) || "---";
  const municipioText = toTitle(municipio) || "---";
  const body = [
    `${ESC}@`,
    `${ESC}a\x01`,
    "SES\n",
    "ESCARAPELA\n",
    `${ESC_POS_DIVIDER}\n`,
    ...nameLines.map((line) => `${line}\n`),
    "\n",
    `${ESC}a\x00`,
    `Cargo: ${cargoText}\n`,
    `Municipio: ${municipioText}\n`,
    "\n\n\n",
    `${ESC}d\x04`,
  ].join("");

  await rawPrinter.printRawText(body);
  await wait(250);
}

export async function imprimirEscarapela(params: EscarapelaPrintData): Promise<void> {
  try {
    await imprimirEscarapelaRawEscpos(params);
  } catch (error) {
    try {
      await imprimirEscarapelaEscpos(params);
    } catch {
      await imprimirEscarapelaTsc(params);
    }
  }
}

export async function imprimirPruebaImpresora(): Promise<void> {
  await imprimirEscarapela({
    nombre: "PRUEBA IMPRESORA",
    cargo: "Conexion Bluetooth",
    municipio: "Y41BT",
  });
}

export const imprimirTicket = imprimirEscarapela;
