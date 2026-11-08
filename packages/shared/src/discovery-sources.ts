import { z } from 'zod';

const HOSTS = { greenhouse: ['boards.greenhouse.io', 'job-boards.greenhouse.io'], ashby: ['jobs.ashbyhq.com'], lever: ['jobs.lever.co'] };
function boards(kind: keyof typeof HOSTS) {
  return z.array(z.string().trim().min(1).max(500).transform((value, ctx) => {
    let slug = value;
    let departmentId: string | null = null;
    let team: string | null = null;
    if (/^https?:\/\//i.test(value)) {
      let url: URL;
      try { url = new URL(value); } catch { ctx.addIssue({code:'custom',message:'Link de mural inválido.'}); return z.NEVER; }
      const ownAshbyCareers = kind === 'ashby' && ['www.ashbyhq.com','ashbyhq.com'].includes(url.hostname) && url.pathname.replace(/\/$/,'') === '/careers';
      if ((!HOSTS[kind].includes(url.hostname) && !ownAshbyCareers) || url.username || url.password || url.port) {
        ctx.addIssue({ code: 'custom', message: `Use um link de mural ${kind}.` }); return z.NEVER;
      }
      slug = ownAshbyCareers ? 'ashby' : url.pathname.split('/').filter(Boolean)[0] ?? '';
      if(kind==='ashby') {
        departmentId = url.searchParams.get('ashby_department_id');
        if(departmentId!==null&&!z.uuid().safeParse(departmentId).success) { ctx.addIssue({code:'custom',message:'Filtro de departamento Ashby inválido.'});return z.NEVER; }
        if([...url.searchParams.keys()].some(key=>key.startsWith('ashby_')&&key!=='ashby_department_id')) {ctx.addIssue({code:'custom',message:'Este filtro Ashby ainda não é suportado. Use o filtro de departamento.'});return z.NEVER;}
      }
      if(kind==='lever') {
        team=url.searchParams.get('team');
        if(team!==null){team=team.trim();if(!team||team.length>120||/[\x00-\x1f]/.test(team)||url.searchParams.getAll('team').length!==1){ctx.addIssue({code:'custom',message:'Filtro de equipe Lever inválido.'});return z.NEVER;}}
        if([...url.searchParams.keys()].some(key=>['location','department','commitment','level','workplaceType'].includes(key))){ctx.addIssue({code:'custom',message:'Este filtro Lever ainda não é suportado. Use o filtro de equipe (team).'});return z.NEVER;}
      }
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(slug)) {
      ctx.addIssue({ code: 'custom', message: 'Informe o link do mural ou seu identificador, sem espaços.' }); return z.NEVER;
    }
    if(departmentId)return `https://jobs.ashbyhq.com/${slug}?ashby_department_id=${departmentId}`;
    if(team)return `https://jobs.lever.co/${slug}?team=${encodeURIComponent(team)}`;
    return slug;
  })).max(50).transform(values => [...new Set(values)]);
}
export const sourceSettingsSchema = z.strictObject({ greenhouse: boards('greenhouse'), ashby: boards('ashby'), lever: boards('lever') });
export type SourceSettings = z.infer<typeof sourceSettingsSchema>;
export function ashbyBoardReference(value:string): {slug:string;departmentId:string|null} {
  if(!value.startsWith('https://'))return {slug:value,departmentId:null};
  const url=new URL(value);return {slug:url.pathname.split('/').filter(Boolean)[0],departmentId:url.searchParams.get('ashby_department_id')};
}
export function leverBoardReference(value:string): {slug:string;team:string|null} {
  if(!value.startsWith('https://'))return {slug:value,team:null};
  const url=new URL(value);return {slug:url.pathname.split('/').filter(Boolean)[0],team:url.searchParams.get('team')};
}
export const sourceDiagnosticSchema = z.object({ name:z.string(), status:z.enum(['not-configured','not-tested','disabled','ok','empty','partial','error']), count:z.number().int().nonnegative(), message:z.string() });
export type SourceDiagnostic = z.infer<typeof sourceDiagnosticSchema>;
export const sourceOverviewSchema = z.object({ settings:sourceSettingsSchema, checkedAt:z.iso.datetime().nullable(), sources:z.array(sourceDiagnosticSchema), email:z.object({configured:z.boolean(),missingFields:z.array(z.string()),mailbox:z.string()}) });
export type SourceOverview = z.infer<typeof sourceOverviewSchema>;
