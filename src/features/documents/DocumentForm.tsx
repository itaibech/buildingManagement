import { Button, FileInput, Group, Radio, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPaperclip } from '@tabler/icons-react'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { createDocument, docFileProblem, updateDocument, useDocumentCall, type BuildingDocument, type DocumentInput } from './api'
import { CATEGORIES, type Category, type Visibility } from './logic'

const T = he.documents
const F = T.fields
const ACCEPT = 'application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/heic,image/heif'
const CATEGORY_OPTIONS = CATEGORIES.map((value) => ({ value, label: T.categories[value] }))
const PROBLEMS = { type: T.errors.fileType, empty: T.errors.fileEmpty, size: T.errors.fileSize } as const

interface Values {
  title: string
  category: Category
  description: string
  document_date: string
  expires_on: string
  visibility: Visibility
  file: File | null
}

const initial = (doc?: BuildingDocument): Values => ({
  title: doc?.title ?? '', category: doc?.category ?? 'legal', description: doc?.description ?? '',
  document_date: doc?.document_date ?? '', expires_on: doc?.expires_on ?? '', visibility: doc?.visibility ?? 'residents', file: null,
})

const toInput = (v: Values): DocumentInput => ({
  title: v.title.trim(), category: v.category, description: v.description.trim(),
  document_date: v.document_date || null, expires_on: v.expires_on || null, visibility: v.visibility,
})

function useDocumentForm(doc?: BuildingDocument) {
  return useForm<Values>({
    initialValues: initial(doc),
    validate: {
      title: (v) => (v.trim() ? null : T.errors.title),
      expires_on: (v, all) => (v && all.document_date && v < all.document_date ? T.errors.expiry : null),
      file: (f) => {
        if (!f) return doc ? null : T.errors.file
        const problem = docFileProblem(f)
        return problem ? PROBLEMS[problem] : null
      },
    },
  })
}

/** Admin: upload a new document, or edit one's details (a file there becomes its new version). */
export function DocumentForm({ doc, onDone }: { doc?: BuildingDocument; onDone: () => void }) {
  const form = useDocumentForm(doc)
  const call = useDocumentCall()
  const submit = form.onSubmit((v) => {
    const input = toInput(v)
    const { file } = v
    const run = doc ? () => updateDocument(doc.id, input, file) : file ? () => createDocument(input, file) : null
    if (run) call.mutate(run, { onSuccess: () => { notifySuccess(doc ? T.updated : T.created); onDone() } })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={F.title} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Select label={F.category} data={CATEGORY_OPTIONS} allowDeselect={false} {...form.getInputProps('category')} />
        <FileInput label={doc ? F.newFile : F.file} withAsterisk={!doc} description={doc ? F.newFileHint : F.fileHint} accept={ACCEPT}
          placeholder={F.pickFile} clearable leftSection={<IconPaperclip size={18} stroke={1.75} aria-hidden="true" />} {...form.getInputProps('file')} />
        <Textarea label={F.description} autosize minRows={2} maxLength={2000} {...form.getInputProps('description')} />
        <Group grow align="flex-start" wrap="wrap">
          <DateInput label={F.documentDate} miw={160} {...form.getInputProps('document_date')} />
          <DateInput label={F.expiresOn} miw={160} {...form.getInputProps('expires_on')} />
        </Group>
        <Text size="xs" c="dimmed" mt={-8}>{F.expiresHint}</Text>
        <Radio.Group label={F.visibility} {...form.getInputProps('visibility')}>
          <Group gap="lg" mt={6}>
            <Radio value="residents" label={T.visibility.residents} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
            <Radio value="committee" label={T.visibility.committee} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
          </Group>
        </Radio.Group>
        <Button type="submit" fullWidth loading={call.isPending}>{doc ? T.save : T.create}</Button>
      </Stack>
    </form>
  )
}
