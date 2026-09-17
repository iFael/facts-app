export type RegistrationStatus='new'|'pending'|'confirmed';

export function registrationStatus(user?:{email_confirmed_at?:string|null}):RegistrationStatus{
 if(!user)return 'new';
 return user.email_confirmed_at?'confirmed':'pending';
}
