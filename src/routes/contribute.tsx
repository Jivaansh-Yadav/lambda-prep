import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState, type DragEvent } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  FileText,
  Link2,
  Loader2,
  MessageCircle,
  UploadCloud,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { classes, getSubjects, pageHead } from '@/lib/lambda-prep';
import { submitContributionLink, submitContributionUpload } from '@/lib/contribute-server';
import { UPLOAD_ACCEPT, allowedExtensionList, resolveUploadType } from '@/lib/upload-policy';
import {
  CONTRIBUTION_FIELD_LABELS,
  missingFields,
  validateContribution,
  type ContributionErrors,
  type ContributionField,
} from '@/lib/contribute-form';
import { DISCORD_ICSE_LABEL, DISCORD_ISC_LABEL, communityLinks } from '@/lib/lambda-prep';

export const Route = createFileRoute('/contribute')({
  head: () =>
    pageHead(
      'Contribute a resource',
      'Share a note, practice paper or study material with the Lambda Prep community — upload it or share a Drive link for review.',
      '/contribute',
    ),
  component: ContributePage,
});

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const OTHER_SUBJECT_VALUE = '__other__';

/** DOM id of the control that owns each validated field. */
const FIELD_CONTROL_IDS: Record<ContributionField, string> = {
  fileName: 'contribute-filename',
  classSlug: 'contribute-class',
  subject: 'contribute-subject',
  file: 'contribute-dropzone',
  driveLink: 'contribute-drive-link',
  contactMethod: 'contribute-contact',
};

type Method = 'upload' | 'link';
type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The asterisk on a required label. `aria-required` on the control carries
 * the same information for screen readers, so the glyph is decorative. */
function RequiredMark() {
  return <span className="contribute-required" aria-hidden="true">*</span>;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="contribute-hint is-error" id={id}>
      {message}
    </p>
  );
}

function ContributePage() {
  // --- Details (shared by both submission paths) ---
  const [classSlug, setClassSlug] = useState('');
  const [subject, setSubject] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [fileName, setFileName] = useState('');
  const [description, setDescription] = useState('');
  const [alias, setAlias] = useState('');
  const [contactMethod, setContactMethod] = useState('');

  // --- Method: upload vs. share-link ---
  const [method, setMethod] = useState<Method>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [driveLink, setDriveLink] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Errors only appear once the contributor has tried to submit, so an
  // untouched form is not pre-scolded — but every field re-validates on
  // each keystroke after that, so a message disappears as soon as it is fixed.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const selectedClass = classes.find((c) => c.slug === classSlug);
  const subjectOptions = selectedClass ? getSubjects(selectedClass.board) : [];
  const isOtherSubject = subject === OTHER_SUBJECT_VALUE;
  const resolvedSubject = isOtherSubject ? customSubject.trim() : subject;

  function pickFile(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setErrorMessage(`That file is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB). Try sharing a Drive link instead.`);
      return;
    }
    // Mirrors the server allowlist so the rejection happens before a 50 MB
    // upload attempt (GH #2). The server checks again — this is the friendly
    // half of the same rule.
    if (!resolveUploadType(next.name)) {
      setErrorMessage(`That file type isn't accepted. Use ${allowedExtensionList()}, or share a Drive link instead.`);
      return;
    }
    setErrorMessage(null);
    setFile(next);
    if (!fileName) setFileName(next.name);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  }

  const draft = {
    fileName,
    classSlug,
    subject: resolvedSubject,
    method,
    hasFile: !!file,
    driveLink,
    contactMethod,
  };
  const errors: ContributionErrors = submitAttempted ? validateContribution(draft) : {};
  const missing = missingFields(errors);
  // The button is never disabled for missing input: a disabled button with no
  // explanation was the bug (GH #15). Submitting runs validation, shows the
  // messages and moves focus to the first field that needs attention.
  const canSubmit = submitState !== 'submitting';

  function focusFirstInvalid(next: ContributionErrors) {
    const [first] = missingFields(next);
    if (!first) return;
    // "Other" hides the real input behind a select that already has a value,
    // so point at the text field the contributor still has to fill in.
    const id = first === 'subject' && isOtherSubject ? 'contribute-subject-other' : FIELD_CONTROL_IDS[first];
    // Wait a frame so the error text is in the DOM (and announced) before focus
    // lands on the control it belongs to.
    requestAnimationFrame(() => {
      document.getElementById(id)?.focus();
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitState === 'submitting') return;

    setSubmitAttempted(true);
    const nextErrors = validateContribution(draft);
    if (missingFields(nextErrors).length > 0) {
      focusFirstInvalid(nextErrors);
      return;
    }

    setSubmitState('submitting');
    setErrorMessage(null);

    const classLabel = selectedClass ? `${selectedClass.board} Class ${selectedClass.grade}` : classSlug;

    try {
      if (method === 'upload') {
        if (!file) return;
        const form = new FormData();
        form.set('file', file);
        form.set('fileName', fileName.trim());
        form.set('classSlug', classSlug);
        form.set('classLabel', classLabel);
        form.set('subject', resolvedSubject);
        form.set('description', description.trim());
        form.set('contributorAlias', alias.trim());
        form.set('contactMethod', contactMethod.trim());
        const res = await submitContributionUpload({ data: form });
        if (res.ok) {
          setSubmitState('done');
        } else {
          setSubmitState('error');
          setErrorMessage(res.reason);
        }
      } else {
        const res = await submitContributionLink({
          data: {
            driveLink: driveLink.trim(),
            fileName: fileName.trim(),
            classSlug,
            classLabel,
            subject: resolvedSubject,
            description: description.trim(),
            contributorAlias: alias.trim(),
            contactMethod: contactMethod.trim(),
          },
        });
        if (res.ok) {
          setSubmitState('done');
        } else {
          setSubmitState('error');
          setErrorMessage(res.reason);
        }
      }
    } catch (error) {
      console.error('[contribute] submission failed', error);
      setSubmitState('error');
      setErrorMessage('Something went wrong. Please try again.');
    }
  }

  function resetForm() {
    setClassSlug('');
    setSubject('');
    setCustomSubject('');
    setFileName('');
    setDescription('');
    setAlias('');
    setContactMethod('');
    setMethod('upload');
    setFile(null);
    setDriveLink('');
    setSubmitState('idle');
    setErrorMessage(null);
    setSubmitAttempted(false);
  }

  if (submitState === 'done') {
    return (
      <main className="container content-page contribute-page">
        <div className="contribute-success">
          <span className="contribute-success-icon">
            <CheckCircle2 size={40} strokeWidth={1.6} />
          </span>
          <h1>Thanks for contributing<span className="text-primary">.</span></h1>
          <p>
            Your submission is in the review queue. We'll check it for syllabus relevance and clarity, and
            reach out via the contact details you shared if we need anything else.
          </p>
          <Button onClick={resetForm}>Contribute another resource</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="container content-page contribute-page">
      <p className="eyebrow">Community</p>
      <h1>Contribute a resource<span className="text-primary">.</span></h1>
      <p className="page-intro">
        Share a note, revision sheet, practice paper or any other study material. Every contribution is
        reviewed before it's added to the library — nothing goes live automatically.
      </p>

      <form className="contribute-form" onSubmit={handleSubmit} noValidate>
        {/* Step 1 — details */}
        <section className="contribute-section">
          <h2 className="contribute-section-title">
            <span className="contribute-step">1</span> Resource details
          </h2>

          <div className="contribute-grid">
            <div className="contribute-field">
              <Label htmlFor="contribute-filename">File name<RequiredMark /></Label>
              <Input
                id="contribute-filename"
                placeholder="e.g. Chemical Bonding — Revision Notes.pdf"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                maxLength={200}
                aria-required="true"
                aria-invalid={errors.fileName ? true : undefined}
                aria-describedby={errors.fileName ? 'contribute-filename-error' : undefined}
              />
              <FieldError id="contribute-filename-error" message={errors.fileName} />
            </div>

            <div className="contribute-field">
              <Label htmlFor="contribute-class">Class<RequiredMark /></Label>
              <Select
                value={classSlug}
                onValueChange={(next) => {
                  setClassSlug(next);
                  setSubject('');
                  setCustomSubject('');
                }}
              >
                <SelectTrigger
                  id="contribute-class"
                  aria-required="true"
                  aria-invalid={errors.classSlug ? true : undefined}
                  aria-describedby={errors.classSlug ? 'contribute-class-error' : undefined}
                >
                  <SelectValue placeholder="Select your class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.board} Class {c.grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="contribute-class-error" message={errors.classSlug} />
            </div>

            <div className="contribute-field">
              <Label htmlFor="contribute-subject">Subject<RequiredMark /></Label>
              <Select value={subject} onValueChange={setSubject} disabled={!selectedClass}>
                <SelectTrigger
                  id="contribute-subject"
                  aria-required="true"
                  aria-invalid={errors.subject ? true : undefined}
                  aria-describedby={errors.subject ? 'contribute-subject-error' : undefined}
                >
                  <SelectValue placeholder={selectedClass ? 'Select a subject' : 'Choose a class first'} />
                </SelectTrigger>
                <SelectContent>
                  {subjectOptions.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_SUBJECT_VALUE}>Other</SelectItem>
                </SelectContent>
              </Select>
              {isOtherSubject && (
                <Input
                  id="contribute-subject-other"
                  className="contribute-subject-other-input"
                  placeholder="Type the subject name"
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  maxLength={100}
                  aria-required="true"
                  aria-invalid={errors.subject ? true : undefined}
                  aria-describedby={errors.subject ? 'contribute-subject-error' : undefined}
                />
              )}
              <FieldError id="contribute-subject-error" message={errors.subject} />
            </div>

            <div className="contribute-field contribute-field-wide">
              <Label htmlFor="contribute-description">Description (optional)</Label>
              <Textarea
                id="contribute-description"
                placeholder="What is this resource, and what makes it useful? e.g. chapter-wise summary with solved examples."
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                rows={3}
              />
            </div>

            <div className="contribute-field">
              <Label htmlFor="contribute-alias">Your name or alias (optional)</Label>
              <Input
                id="contribute-alias"
                placeholder="Reddit / Discord username, or any name"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
        </section>

        {/* Step 2 — method */}
        <section className="contribute-section">
          <h2 className="contribute-section-title">
            <span className="contribute-step">2</span> Share the file
          </h2>

          <div className="contribute-method-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'upload'}
              className={`contribute-method-tab ${method === 'upload' ? 'is-active' : ''}`}
              onClick={() => setMethod('upload')}
            >
              <UploadCloud size={16} /> Upload the file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'link'}
              className={`contribute-method-tab ${method === 'link' ? 'is-active' : ''}`}
              onClick={() => setMethod('link')}
            >
              <Link2 size={16} /> Share a Drive link
            </button>
          </div>

          {method === 'upload' ? (
            <>
            <div
              id="contribute-dropzone"
              className={`contribute-dropzone ${dragOver ? 'is-dragover' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-required="true"
              aria-invalid={errors.file ? true : undefined}
              aria-describedby={errors.file ? 'contribute-file-error' : undefined}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                // Without this, Space both opens the picker and scrolls the
                // page — role="button" only changes the ARIA semantics, it does
                // not suppress the browser's default scroll-on-Space (GH #11).
                e.preventDefault();
                fileInputRef.current?.click();
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={UPLOAD_ACCEPT}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="contribute-dropzone-file">
                  <FileText size={28} strokeWidth={1.6} />
                  <div className="contribute-dropzone-file-meta">
                    <span className="contribute-dropzone-file-name">{file.name}</span>
                    <span className="contribute-dropzone-file-size">{formatBytes(file.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="contribute-dropzone-remove"
                    aria-label="Remove file"
                    onClick={(e) => {
                      e.stopPropagation();
                      pickFile(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <CloudUpload size={32} strokeWidth={1.5} />
                  <p className="contribute-dropzone-title">Drag and drop your file here</p>
                  <p className="contribute-dropzone-subtitle" id="contribute-file-hint">
                    or click to browse — PDF, DOCX, PPTX, images (max 50MB)
                  </p>
                </>
              )}
            </div>
            <FieldError id="contribute-file-error" message={errors.file} />
            </>
          ) : (
            <div className="contribute-link-field">
              <Label htmlFor="contribute-drive-link">Shareable Google Drive link<RequiredMark /></Label>
              <Input
                id="contribute-drive-link"
                type="url"
                placeholder="https://drive.google.com/file/d/..."
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                aria-required="true"
                aria-invalid={errors.driveLink ? true : undefined}
                aria-describedby={
                  errors.driveLink
                    ? 'contribute-drive-link-hint contribute-drive-link-error'
                    : 'contribute-drive-link-hint'
                }
              />
              <FieldError id="contribute-drive-link-error" message={errors.driveLink} />
              <p className="contribute-hint" id="contribute-drive-link-hint">
                Make sure link sharing is turned on ("Anyone with the link can view") so we can open it.
              </p>
            </div>
          )}
        </section>

        {/* Step 3 — contact */}
        <section className="contribute-section">
          <h2 className="contribute-section-title">
            <span className="contribute-step">3</span> How can we reach you?
          </h2>
          <div className="contribute-field contribute-field-wide">
            <Label htmlFor="contribute-contact">Contact method<RequiredMark /></Label>
            <Input
              id="contribute-contact"
              placeholder="Discord, Reddit DM, email — whatever's easiest for you"
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value)}
              maxLength={300}
              aria-required="true"
              aria-invalid={errors.contactMethod ? true : undefined}
              aria-describedby={
                errors.contactMethod
                  ? 'contribute-contact-hint contribute-contact-error'
                  : 'contribute-contact-hint'
              }
            />
            <FieldError id="contribute-contact-error" message={errors.contactMethod} />
            <p className="contribute-hint" id="contribute-contact-hint">
              <MessageCircle size={13} /> Used only if we have a question about your submission, or to let
              you know once it's reviewed.
            </p>
          </div>
        </section>

        {errorMessage && <p className="contribute-error" role="alert">{errorMessage}</p>}

        {submitAttempted && missing.length > 0 && (
          <p className="contribute-error" role="status">
            Still needed: {missing.map((field) => CONTRIBUTION_FIELD_LABELS[field]).join(', ')}.
          </p>
        )}

        <div className="contribute-submit-row">
          <p className="contribute-submit-note">
            Want to contribute without any of this? Post directly on{' '}
            <a href={communityLinks.redditIcse} target="_blank" rel="noreferrer">
              r/ICSE
            </a>{' '}
            and{' '}
            <a href={communityLinks.redditIscnerds} target="_blank" rel="noreferrer">
              r/ISCNERDS
            </a>{' '}
            or the{' '}
            <a href={communityLinks.discordIcse} target="_blank" rel="noreferrer">
              {DISCORD_ICSE_LABEL}
            </a>{' '}
            and{' '}
            <a href={communityLinks.discordIsc} target="_blank" rel="noreferrer">
              {DISCORD_ISC_LABEL}
            </a>{' '}
            Discord servers.
          </p>
          <Button type="submit" size="lg" disabled={!canSubmit}>
            {submitState === 'submitting' ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Submitting…
              </>
            ) : (
              'Submit for review'
            )}
          </Button>
        </div>
      </form>
    </main>
  );
}
