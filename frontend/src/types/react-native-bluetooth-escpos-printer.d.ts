// Declaración de módulo para react-native-bluetooth-escpos-printer
// No tiene tipos oficiales publicados en @types/

declare module 'react-native-bluetooth-escpos-printer' {
  export const BluetoothManager: {
    enableBluetooth(): Promise<void>;
    disableBluetooth(): Promise<void>;
    scanDevices(): Promise<{ paired?: string; found?: string }>;
    connect(address: string): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): Promise<boolean>;
  };

  export const BluetoothEscposPrinter: {
    ALIGN: {
      LEFT: number;
      CENTER: number;
      RIGHT: number;
    };
    printerAlign(align: number): Promise<void>;
    printText(text: string, options: Record<string, any>): Promise<void>;
    printColumn(
      columnWidths: number[],
      columnAligns: number[],
      columnTexts: string[],
      options: Record<string, any>
    ): Promise<void>;
    printPic(base64: string, options: Record<string, any>): Promise<void>;
    cutOnePoint(): Promise<void>;
    cutFullPaper(mode?: number): Promise<void>;
    selfTest(): Promise<void>;
  };

  export const BluetoothTscPrinter: {
    DIRECTION: {
      FORWARD: number;
      BACKWARD: number;
    };
    DENSITY: Record<string, number>;
    FONTTYPE: Record<string, string>;
    FONTMUL: Record<string, number>;
    ROTATION: Record<string, number>;
    TEAR: {
      ON: string;
      OFF: string;
    };
    PRINT_SPEED: Record<string, number>;
    BARCODETYPE: Record<string, string>;
    BITMAP_MODE: Record<string, number>;
    EEC: Record<string, string>;
    READABLE: Record<string, number>;
    printLable(options: Record<string, any>): Promise<void>;
  };
}
