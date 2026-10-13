module.exports = {
  dependencies: {
    "react-native-bluetooth-escpos-printer": {
      platforms: {
        android: {
          packageImportPath: "import cn.jystudio.bluetooth.RNBluetoothEscposPrinterPackage;",
          packageInstance: "new RNBluetoothEscposPrinterPackage()",
        },
      },
    },
  },
};
