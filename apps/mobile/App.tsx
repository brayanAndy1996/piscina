import { useState } from 'react';
import { Button,SafeAreaView } from 'react-native';
import DiagnosticScreen from './src/DiagnosticScreen';
import AccessScreen from './src/AccessScreen';
export default function App(){const [diagnostic,setDiagnostic]=useState(false);return <SafeAreaView style={{flex:1}}><Button title={diagnostic?'Volver a acceso':'Diagnóstico del servicio'} onPress={()=>setDiagnostic(!diagnostic)}/>{diagnostic?<DiagnosticScreen/>:<AccessScreen/>}</SafeAreaView>;}
