import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { checkApi } from './src/api';
import { openDiagnostics, readDiagnostic, saveDiagnostic } from './src/diagnostics';
import type { Diagnostic } from './src/diagnostic-schema';

export default function App() {
  const dbRef = useRef<SQLiteDatabase | null>(null);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [cached, setCached] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void (async () => {
      const db = await openDiagnostics();
      if (!active) { await db.closeAsync(); return; }
      dbRef.current = db;
      const previous = await readDiagnostic(db);
      if (active) { setDiagnostic(previous); setStorageReady(true); }
    })().catch(() => { if (active) setError('No se pudo abrir el almacenamiento local.'); });
    return () => {
      active = false;
      mounted.current = false;
      const db = dbRef.current;
      dbRef.current = null;
      void db?.closeAsync().catch(() => {});
      // Cerrar la conexión conserva el archivo local.
    };
  }, []);

  async function refresh() {
    if (busyRef.current || !dbRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null); setCached(true);
    try {
      const result = await checkApi(process.env.EXPO_PUBLIC_API_URL);
      await saveDiagnostic(dbRef.current, result);
      if (mounted.current) { setDiagnostic(result); setCached(false); }
    } catch {
      if (mounted.current) setError('No se pudo actualizar. Revisa la URL de API y la conexión; el dato guardado puede estar desactualizado.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <SafeAreaView style={styles.screen}>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Academia de natación</Text>
      <Text>Base técnica en desarrollo</Text>
      <Text style={styles.heading}>Estado del servicio</Text>
      <Text>{diagnostic ? (diagnostic.status === 'ready' ? 'API y PostgreSQL disponibles' : 'Servicio no disponible') : 'Sin comprobaciones guardadas'}</Text>
      {diagnostic && <Text>{cached ? 'Último dato guardado' : 'Respuesta recién obtenida'}: {new Date(diagnostic.checked_at).toLocaleString('es-PE')}</Text>}
      <Text>Esta pantalla no confirma sincronización ni habilita operación offline de la academia.</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {busy && <ActivityIndicator accessibilityLabel="Consultando servicio" />}
      <Button title="Comprobar conexión" onPress={() => { void refresh(); }} disabled={busy || !storageReady} />
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f9' },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  heading: { fontSize: 19, fontWeight: '600' },
  error: { color: '#8b1a1a' },
});
