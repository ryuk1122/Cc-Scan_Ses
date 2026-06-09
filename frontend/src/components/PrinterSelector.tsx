import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { listarImpresoras, guardarImpresora, type Impresora } from '@/src/utils/printer';

export default function PrinterSelector() {
  const [lista, setLista] = useState<Impresora[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardada, setGuardada] = useState<string | null>(null);
  const [conectando, setConectando] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('printer_name').then(n => setGuardada(n));
  }, []);

  const buscar = async () => {
    setCargando(true);
    try {
      setLista(await listarImpresoras());
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setCargando(false);
    }
  };

  const seleccionar = async (device: Impresora) => {
    setConectando(device.address);
    try {
      await guardarImpresora(device.address, device.name);
      setGuardada(device.name);
      Alert.alert('✓ Conectado', device.name);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setConectando(null);
    }
  };

  return (
    <View style={s.wrap}>
      {guardada && (
        <Text style={s.activa}>🖨 Impresora activa: {guardada}</Text>
      )}
      <TouchableOpacity onPress={buscar} style={s.btn}>
        <Text style={s.btnText}>
          {cargando ? 'Buscando...' : 'Buscar impresoras Bluetooth'}
        </Text>
      </TouchableOpacity>
      {cargando && <ActivityIndicator style={{ marginTop: 8 }} />}
      <FlatList
        data={lista}
        keyExtractor={i => i.address}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => seleccionar(item)} style={s.item}>
            <Text style={s.itemName}>{item.name || 'Sin nombre'}</Text>
            <Text style={s.itemMac}>{item.address}</Text>
            {conectando === item.address && <ActivityIndicator size="small" />}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10 },
  activa: { color: theme.success, fontWeight: '700', fontSize: 13 },
  btn: { backgroundColor: theme.brand, padding: 12, borderRadius: 8 },
  btnText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  item: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, borderWidth: 1, borderColor: theme.border,
    borderRadius: 8, marginTop: 6,
  },
  itemName: { color: theme.text, fontWeight: '600' },
  itemMac: { color: theme.textDisabled, fontSize: 11 },
});
