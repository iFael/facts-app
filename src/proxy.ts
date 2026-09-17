import type {NextRequest} from 'next/server';
import {refreshAuthSession} from './lib/supabase/proxy';

export function proxy(request:NextRequest){
 return refreshAuthSession(request);
}

export const config={matcher:['/']};
