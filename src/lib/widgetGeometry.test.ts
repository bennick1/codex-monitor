import { expect, it } from 'vitest';
import { expandedHeightMode } from './widgetGeometry';
import type { ProviderSnapshot } from '../types';
const snapshot:ProviderSnapshot={provider:'codex',displayName:'CODEX',plan:null,shortWindow:null,weeklyWindow:{remainingPercent:50,resetsAt:null,windowSeconds:604800},resetCredits:null,updatedAt:new Date().toISOString(),status:'ok',message:null};
it('uses compact only for displayable weekly-only providers',()=>{
 expect(expandedHeightMode(snapshot)).toBe('compact');
 for(const status of ['signed_out','unavailable','loading'] as const) expect(expandedHeightMode({...snapshot,status})).toBe('full');
 expect(expandedHeightMode({...snapshot,weeklyWindow:null})).toBe('full');
 expect(expandedHeightMode({...snapshot,shortWindow:{remainingPercent:70,resetsAt:null,windowSeconds:18000}})).toBe('full');
 expect(expandedHeightMode({...snapshot,status:'stale'})).toBe('compact');
 expect(expandedHeightMode({...snapshot,status:'stale',updatedAt:'2000-01-01T00:00:00Z'})).toBe('full');
});
