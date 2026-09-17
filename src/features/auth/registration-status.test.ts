import {describe,expect,it} from 'vitest';
import {registrationStatus} from '../../../supabase/functions/_shared/registration-status';

describe('registrationStatus',()=>{
 it('retorna new quando o e-mail não existe',()=>{expect(registrationStatus(undefined)).toBe('new');});
 it('retorna pending quando existe sem confirmação',()=>{expect(registrationStatus({email_confirmed_at:null})).toBe('pending');});
 it('retorna confirmed quando o e-mail já foi confirmado',()=>{expect(registrationStatus({email_confirmed_at:'2026-09-14T12:00:00Z'})).toBe('confirmed');});
});
