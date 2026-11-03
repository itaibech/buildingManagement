import { ActionIcon, Alert, Box, Button, FileButton, Image, Input, Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconCamera, IconX } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { focusFirstError, notifyError, notifySuccess } from '../../ui'
import { useCreatePost, useUpdatePost, type Post, type PostInput } from './api'
import { asCategory, CATEGORIES, hasText, limitMessage, MAX_BODY, MAX_TITLE, photoError } from './board'

const C = he.community
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: C.categories[c] }))

/** One optional photo with a preview (the preview URL is revoked when replaced or unmounted). */
function SinglePhoto({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  const pick = (f: File | null) => {
    const problem = f ? photoError(f) : null
    setError(problem)
    if (!problem) onChange(f)
  }
  return (
    <Input.Wrapper label={C.photo} description={C.photoHint} error={error}>
      <Box mt="xs">
        {url ? (
          <Box pos="relative" w={96} h={96}>
            <Image src={url} alt={C.photo} w={96} h={96} radius={10} fit="cover" />
            <ActionIcon pos="absolute" top={-10} style={{ insetInlineEnd: -10 }} size={44} radius="xl" color="dark" variant="filled"
              aria-label={C.removePhoto} onClick={() => onChange(null)}>
              <IconX size={18} stroke={2} />
            </ActionIcon>
          </Box>
        ) : (
          <FileButton onChange={pick} accept="image/*,.heic,.heif">
            {(props) => <Button {...props} variant="light" leftSection={<IconCamera size={20} stroke={1.75} />}>{C.addPhoto}</Button>}
          </FileButton>
        )}
      </Box>
    </Input.Wrapper>
  )
}

function useSubmit(post: Post | undefined, onDone: () => void) {
  const create = useCreatePost()
  const update = useUpdatePost()
  const submit = (values: PostInput, file: File | null) => {
    if (post) {
      update.mutate({ id: post.id, patch: values }, { onSuccess: () => { notifySuccess(C.saved); onDone() } })
      return
    }
    create.mutate({ values, file }, {
      onSuccess: ({ photoFailed }) => {
        notifySuccess(C.published)
        if (photoFailed) notifyError(C.errors.photo)
        onDone()
      },
    })
  }
  const m = post ? update : create
  const error = m.isError ? (limitMessage(m.error, { post: C.errors.postLimit, comment: C.errors.commentLimit }) ?? C.errors.save) : null
  return { submit, pending: m.isPending, error }
}

const trimmed = (v: PostInput): PostInput => ({ category: v.category, title: v.title.trim(), body: hasText(v.body) ? v.body.trim() : '' })

/** The create dialog's form (with one photo), or the author's edit of the text and category. */
export function PostForm({ post, onDone }: { post?: Post; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const { submit, pending, error } = useSubmit(post, onDone)
  const form = useForm<PostInput>({
    initialValues: { category: post?.category ?? 'general', title: post?.title ?? '', body: post?.body ?? '' },
    validate: { title: (v) => (hasText(v) ? null : C.errors.title) },
  })
  return (
    <form onSubmit={form.onSubmit((v) => submit(trimmed(v), file), focusFirstError)} noValidate>
      <Stack>
        <Select label={C.category} data={CATEGORY_OPTIONS} allowDeselect={false} withAsterisk
          {...form.getInputProps('category')} onChange={(v) => form.setFieldValue('category', asCategory(v ?? 'general'))} />
        <TextInput label={C.postTitle} placeholder={C.titlePlaceholder} withAsterisk data-autofocus maxLength={MAX_TITLE} {...form.getInputProps('title')} />
        <Textarea label={C.body} description={C.bodyHint} autosize minRows={3} maxRows={10} maxLength={MAX_BODY} {...form.getInputProps('body')} />
        {!post && <SinglePhoto file={file} onChange={setFile} />}
        {error && <Alert color="debt">{error}</Alert>}
        <Button type="submit" fullWidth loading={pending}>{post ? C.save : C.publish}</Button>
      </Stack>
    </form>
  )
}
