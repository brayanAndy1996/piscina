import { requireNativeModule } from 'expo';
import type { ClockSnapshot } from './offline-policy';
export async function deviceClock():Promise<ClockSnapshot> {
 try {
  const module=requireNativeModule<{snapshot:()=>Promise<ClockSnapshot>}>('PiscinaClock');
  return await module.snapshot();
 }catch { throw new Error('El acceso offline requiere un build Android con el reloj nativo. Expo Go solo permite acceso online.'); }
}
