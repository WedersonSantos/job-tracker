"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import {
  ageFromBirthDate,
  emptyResume,
  demographicOptions,
  mergeResumeImport,
} from "@recruit/shared";
import type {
  Certification,
  Education,
  Experience,
  Language,
  Project,
  ProfileDetail,
  ProfileLinks,
  Resume,
  FormFillDefaults,
  ResumeFileInfo,
  ResumeImport,
} from "@recruit/shared";
import { Field } from "@/components/field";
import { saveProfileAction } from "@/features/profile/actions";
import { LinkedInImportCard } from "@/features/profile/components/linkedin-import-card";
import { SectionList } from "@/features/profile/components/section-list";
import type { ImportOutcome } from "@/features/profile/linkedin-import";
import { ResumePdfCard } from "./resume-pdf-card";

interface Personal {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: ProfileLinks;
}

export function ResumeForm({
  profile,
  resumeFile,
}: {
  profile: ProfileDetail;
  resumeFile: ResumeFileInfo | null;
}) {
  const [personal, setPersonal] = useState<Personal>({
    name: profile.name,
    headline: profile.headline ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    links: profile.links,
  });
  const [resume, setResume] = useState<Resume>(profile.resume ?? emptyResume);
  const [formFillDefaults, setFormFillDefaults] = useState<FormFillDefaults>({
    ...profile.formFillDefaults,
    fullName: profile.formFillDefaults.fullName ?? profile.name,
  });
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "erro";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const age = ageFromBirthDate(resume.birthDate);

  // O import preenche o formulário; gravar continua sendo decisão sua.
  //
  // Mescla em vez de substituir: o export do LinkedIn não traz data de
  // nascimento nem projetos, e sobrescrever o currículo inteiro apagaria esses
  // campos em silêncio. Só o que o export realmente carrega é trocado.
  const applyImport = useCallback((outcome: ImportOutcome) => {
    if (outcome.fullName)
      setFormFillDefaults((current) => ({
        ...current,
        fullName: outcome.fullName,
      }));
    setResume((current) => ({
      ...outcome.resume,
      birthDate: current.birthDate,
      projects: current.projects,
      summary: outcome.resume.summary ?? current.summary,
    }));
    setPersonal((current) => ({
      ...current,
      headline: outcome.headline ?? current.headline,
      location: outcome.location ?? current.location,
    }));
    setFeedback(null);
  }, []);

  const applyPdfImport = useCallback(
    (value: ResumeImport) => {
      setPersonal((current) => ({
        ...current,
        headline: current.headline.trim()
          ? current.headline
          : (value.headline ?? ""),
        email: current.email.trim() ? current.email : (value.email ?? ""),
        phone: current.phone.trim() ? current.phone : (value.phone ?? ""),
        location: current.location.trim()
          ? current.location
          : (value.location ?? ""),
        links: {
          linkedin: current.links.linkedin || value.links.linkedin,
          github: current.links.github || value.links.github,
          website: current.links.website || value.links.website,
          presentationVideo:
            current.links.presentationVideo || value.links.presentationVideo,
        },
      }));
      setResume((current) => mergeResumeImport(current, value.resume));
      setFormFillDefaults((current) => ({
        ...current,
        fullName:
          !current.fullName?.trim() ||
          (!profile.formFillDefaults.fullName &&
            current.fullName === profile.name)
            ? (value.fullName ?? current.fullName)
            : current.fullName,
        experienceSummary: current.experienceSummary?.trim()
          ? current.experienceSummary
          : value.resume.summary,
      }));
      setFeedback(null);
    },
    [profile.name, profile.formFillDefaults.fullName],
  );

  const save = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveProfileAction(profile.id, {
        name: personal.name,
        headline: personal.headline || null,
        email: personal.email || null,
        phone: personal.phone || null,
        location: personal.location || null,
        links: personal.links,
        resume,
        formFillDefaults,
      });

      if (result.status === "success") {
        setFeedback({ kind: "ok", message: "Currículo salvo." });

        return;
      }

      if (result.status === "error") {
        // Mostra o campo junto da mensagem: "resume.experiences.0.company" diz
        // exatamente qual item da lista está incompleto.
        const detail = Object.entries(result.fieldErrors ?? {})
          .map(([field, message]) => `${field}: ${message}`)
          .join(" · ");

        setFeedback({ kind: "erro", message: detail || result.message });
      }
    });
  };

  const patch = <K extends keyof Resume>(key: K, value: Resume[K]) =>
    setResume((current) => ({ ...current, [key]: value }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-16">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Currículo</h1>
          <Link
            href="/curriculo/imprimir"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Ver e salvar PDF
          </Link>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>

      {feedback && (
        <p
          role="alert"
          className={`text-sm ${feedback.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
        >
          {feedback.message}
        </p>
      )}

      <LinkedInImportCard onImported={applyImport} />
      <ResumePdfCard
        profileId={profile.id}
        initialFile={resumeFile}
        onImported={applyPdfImport}
      />

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Dados pessoais</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Nome do perfil"
            value={personal.name}
            onValueChange={(v) => setPersonal({ ...personal, name: v })}
          />
          <Field
            label="Título"
            placeholder="Backend Sênior"
            value={personal.headline}
            onValueChange={(v) => setPersonal({ ...personal, headline: v })}
          />
          <Field
            label={
              age === null
                ? "Data de nascimento"
                : `Data de nascimento (${age} anos)`
            }
            type="date"
            value={resume.birthDate ?? ""}
            onValueChange={(v) => patch("birthDate", v || null)}
          />
          <Field
            label="Local"
            placeholder="São Paulo, SP"
            value={personal.location}
            onValueChange={(v) => setPersonal({ ...personal, location: v })}
          />
          <Field
            label="Email"
            type="email"
            value={personal.email}
            onValueChange={(v) => setPersonal({ ...personal, email: v })}
          />
          <Field
            label="Telefone"
            type="tel"
            value={personal.phone}
            onValueChange={(v) => setPersonal({ ...personal, phone: v })}
          />
          <Field
            label="LinkedIn"
            type="url"
            placeholder="https://linkedin.com/in/…"
            value={personal.links.linkedin ?? ""}
            onValueChange={(v) =>
              setPersonal({
                ...personal,
                links: { ...personal.links, linkedin: v || null },
              })
            }
          />
          <Field
            label="GitHub"
            type="url"
            placeholder="https://github.com/…"
            value={personal.links.github ?? ""}
            onValueChange={(v) =>
              setPersonal({
                ...personal,
                links: { ...personal.links, github: v || null },
              })
            }
          />
          <Field
            label="Portfólio / site pessoal"
            type="url"
            placeholder="https://seu-portfolio.com"
            value={personal.links.website ?? ""}
            onValueChange={(v) =>
              setPersonal({
                ...personal,
                links: { ...personal.links, website: v || null },
              })
            }
          />
          <Field
            label="Link do vídeo de apresentação"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={personal.links.presentationVideo ?? ""}
            onValueChange={(v) =>
              setPersonal({
                ...personal,
                links: { ...personal.links, presentationVideo: v || null },
              })
            }
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Os links salvos são preenchidos nos campos correspondentes das
          candidaturas. Para o vídeo, use um link que o recrutador consiga
          abrir. Campos vazios não são preenchidos automaticamente.
        </p>
        <Field
          label="Resumo"
          multiline
          placeholder="Dois ou três parágrafos sobre você"
          value={resume.summary ?? ""}
          onValueChange={(v) => patch("summary", v || null)}
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Preenchimento de candidaturas</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Salve as respostas que deseja reutilizar nos formulários. Revise antes
          de enviar cada candidatura.
        </p>
        <Field
          label="Nome completo para candidaturas"
          value={formFillDefaults.fullName ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({ ...formFillDefaults, fullName: v || null })
          }
        />
        <Field
          label="Último salário (opcional)"
          placeholder="Ex.: R$ 4.000 mensais"
          value={formFillDefaults.lastSalary ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({ ...formFillDefaults, lastSalary: v || null })
          }
        />
        <Field
          label="Expectativa salarial / pretensão (opcional)"
          placeholder="Ex.: 5000 ou A combinar"
          value={formFillDefaults.salaryExpectation ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({
              ...formFillDefaults,
              salaryExpectation: v || null,
            })
          }
        />
        <Field
          label="CPF para candidaturas (opcional)"
          placeholder="000.000.000-00"
          value={formFillDefaults.cpf ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({ ...formFillDefaults, cpf: v || null })
          }
        />
        <Field
          label="País de origem (opcional)"
          placeholder="Brasil"
          value={formFillDefaults.countryOfOrigin ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({
              ...formFillDefaults,
              countryOfOrigin: v || null,
            })
          }
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          A resposta é copiada como você escrever, sem conversão de moeda ou
          período. Campos numéricos precisam de um valor como 5000.
        </p>
        <Field
          label="Resumo de experiência para candidaturas (opcional)"
          multiline
          placeholder="Descreva sua experiência profissional para reutilizar em campos de resumo."
          value={formFillDefaults.experienceSummary ?? ""}
          onValueChange={(v) =>
            setFormFillDefaults({
              ...formFillDefaults,
              experienceSummary: v || null,
            })
          }
        />
        {resume.summary && (
          <button
            type="button"
            className="self-start cursor-pointer text-sm underline underline-offset-4 hover:text-zinc-500 dark:hover:text-zinc-400"
            onClick={() =>
              setFormFillDefaults({
                ...formFillDefaults,
                experienceSummary: resume.summary,
              })
            }
          >
            Usar resumo do currículo
          </button>
        )}
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">PCD e autodeclaração</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Todos os campos são opcionais. Escolha “Não preencher
            automaticamente” para deixá-los manuais ou “Prefiro não informar”
            para usar essa resposta. A extensão copia somente o que você salvar,
            sem deduzir dados.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["disabilityStatus", "Pessoa com deficiência (PCD)"],
                ["race", "Cor ou raça"],
                ["sex", "Sexo"],
                ["genderIdentity", "Identidade de gênero"],
                ["sexualOrientation", "Orientação sexual"],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={formFillDefaults[key] ?? ""}
                onValueChange={(value) =>
                  setFormFillDefaults({
                    ...formFillDefaults,
                    [key]: value || null,
                    ...(key === "disabilityStatus" && value !== "Sim"
                      ? { disabilityCid: null }
                      : {}),
                  })
                }
              >
                <option value="">Não preencher automaticamente</option>
                {demographicOptions[key].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Field>
            ))}
          </div>
          {formFillDefaults.disabilityStatus === "Sim" && (
            <Field
              label="CID (opcional, conforme seu laudo)"
              placeholder="Informe o código como consta no seu documento"
              value={formFillDefaults.disabilityCid ?? ""}
              onValueChange={(value) =>
                setFormFillDefaults({
                  ...formFillDefaults,
                  disabilityCid: value || null,
                })
              }
            />
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            O CID só é preenchido quando PCD está salvo como “Sim”. Esses dados
            ficam nas respostas de candidatura, separados da apresentação por
            IA.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">Apresentação para empresas</h3>
          <Field
            label="Apresentação-base (opcional)"
            multiline
            placeholder="Conte os pontos da sua trajetória que deseja destacar. Se deixar vazio, será usado o resumo do currículo."
            value={formFillDefaults.presentationBase ?? ""}
            onValueChange={(v) =>
              setFormFillDefaults({
                ...formFillDefaults,
                presentationBase: v || null,
              })
            }
          />
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
              checked={formFillDefaults.personalizePresentation ?? false}
              onChange={(event) =>
                setFormFillDefaults({
                  ...formFillDefaults,
                  personalizePresentation: event.target.checked,
                })
              }
              aria-describedby="presentation-help"
            />
            Personalizar e preencher a apresentação para cada empresa
          </label>
          <p
            id="presentation-help"
            className="text-xs text-zinc-500 dark:text-zinc-400"
          >
            Na etapa “Apresente-se” da Gupy, a IA usa seu currículo e a vaga
            salva para relacionar sua trajetória ao cargo e à empresa. Respeita
            o limite do campo e preserva textos já preenchidos. Usa a API de IA
            configurada, com cobrança por geração. Revise o texto antes de
            enviar.
          </p>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Deixe uma resposta opcional em branco para não preenchê-la
          automaticamente. Clique em Salvar no topo da página para guardar as
          alterações.
        </p>
      </section>

      <SectionList<Experience>
        title="Experiências"
        items={resume.experiences}
        onChange={(items) => patch("experiences", items)}
        addLabel="Adicionar"
        emptyLabel="Nenhuma experiência ainda."
        emptyItem={() => ({
          company: "",
          role: "",
          location: null,
          startDate: null,
          endDate: null,
          current: false,
          description: null,
        })}
        renderItem={(item, update) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Empresa"
                value={item.company}
                onValueChange={(v) => update({ company: v })}
              />
              <Field
                label="Cargo"
                value={item.role}
                onValueChange={(v) => update({ role: v })}
              />
              <Field
                label="Início (AAAA-MM)"
                type="month"
                value={item.startDate ?? ""}
                onValueChange={(v) => update({ startDate: v || null })}
              />
              <Field
                label="Fim (vazio = atual)"
                type="month"
                value={item.endDate ?? ""}
                onValueChange={(v) =>
                  update({ endDate: v || null, current: !v })
                }
              />
            </div>
            <Field
              label="Descrição"
              multiline
              value={item.description ?? ""}
              onValueChange={(v) => update({ description: v || null })}
            />
          </>
        )}
      />

      <SectionList<Education>
        title="Formação"
        items={resume.education}
        onChange={(items) => patch("education", items)}
        addLabel="Adicionar"
        emptyLabel="Nenhuma formação ainda."
        emptyItem={() => ({
          school: "",
          degree: null,
          field: null,
          startDate: null,
          endDate: null,
        })}
        renderItem={(item, update) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Instituição"
              value={item.school}
              onValueChange={(v) => update({ school: v })}
            />
            <Field
              label="Curso"
              value={item.degree ?? ""}
              onValueChange={(v) => update({ degree: v || null })}
            />
            <Field
              label="Início"
              type="month"
              value={item.startDate ?? ""}
              onValueChange={(v) => update({ startDate: v || null })}
            />
            <Field
              label="Fim"
              type="month"
              value={item.endDate ?? ""}
              onValueChange={(v) => update({ endDate: v || null })}
            />
          </div>
        )}
      />

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Competências</h2>
        <Field
          label="Uma por linha"
          multiline
          placeholder={"Go\nKafka\nPostgreSQL"}
          value={resume.skills.join("\n")}
          onValueChange={(v) =>
            patch(
              "skills",
              v
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </section>

      <SectionList<Project>
        title="Projetos"
        items={resume.projects}
        onChange={(items) => patch("projects", items)}
        addLabel="Adicionar"
        emptyLabel="Nenhum projeto ainda."
        emptyItem={() => ({ name: "", url: null, description: null })}
        renderItem={(item, update) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Nome"
                value={item.name}
                onValueChange={(v) => update({ name: v })}
              />
              <Field
                label="Link"
                type="url"
                value={item.url ?? ""}
                onValueChange={(v) => update({ url: v || null })}
              />
            </div>
            <Field
              label="Descrição"
              multiline
              value={item.description ?? ""}
              onValueChange={(v) => update({ description: v || null })}
            />
          </>
        )}
      />

      <SectionList<Language>
        title="Idiomas"
        items={resume.languages}
        onChange={(items) => patch("languages", items)}
        addLabel="Adicionar"
        emptyLabel="Nenhum idioma ainda."
        emptyItem={() => ({ name: "", level: null })}
        renderItem={(item, update) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Idioma"
              value={item.name}
              onValueChange={(v) => update({ name: v })}
            />
            <Field
              label="Nível"
              value={item.level ?? ""}
              onValueChange={(v) => update({ level: v || null })}
            />
          </div>
        )}
      />

      <SectionList<Certification>
        title="Certificações"
        items={resume.certifications}
        onChange={(items) => patch("certifications", items)}
        addLabel="Adicionar"
        emptyLabel="Nenhuma certificação ainda."
        emptyItem={() => ({ name: "", issuer: null, date: null })}
        renderItem={(item, update) => (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Nome"
              value={item.name}
              onValueChange={(v) => update({ name: v })}
            />
            <Field
              label="Emissor"
              value={item.issuer ?? ""}
              onValueChange={(v) => update({ issuer: v || null })}
            />
            <Field
              label="Data"
              type="month"
              value={item.date ?? ""}
              onValueChange={(v) => update({ date: v || null })}
            />
          </div>
        )}
      />
    </div>
  );
}
