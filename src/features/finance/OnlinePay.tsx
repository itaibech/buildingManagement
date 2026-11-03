import { Button, Card, Stack, Switch, Text, Title } from '@mantine/core'
import { IconCreditCard } from '@tabler/icons-react'
import { ONLINE_PAYMENTS_ENABLED } from '../../lib/flags'
import { he } from '../../lib/he'

const P = he.onlinePay

/** Resident, beside the balance / "איך משלמים": a disabled "תשלום אונליין (בקרוב)". No payment code behind it. */
export function OnlinePaySoon() {
  return (
    <Stack gap={4} data-testid="online-pay-soon">
      <Button variant="default" fullWidth disabled={!ONLINE_PAYMENTS_ENABLED} aria-describedby="bm-online-pay-soon"
        leftSection={<IconCreditCard size={20} stroke={1.75} aria-hidden="true" />}>{P.button}</Button>
      <Text id="bm-online-pay-soon" size="sm" c="dimmed">{P.soon}</Text>
    </Stack>
  )
}

/** Admin settings: "תשלום אונליין – בבדיקה", with the toggle shown but disabled until a decision is made. */
export function OnlinePaySettingsCard() {
  return (
    <Card maw={720}>
      <Title order={2} size="h4" mb="xs">{P.adminTitle}</Title>
      <Stack gap="sm">
        <Text size="sm">{P.adminBody}</Text>
        <Text size="sm" c="dimmed">{P.adminDoc}</Text>
        <Switch label={P.toggle} description={P.toggleHint} checked={ONLINE_PAYMENTS_ENABLED} disabled readOnly />
      </Stack>
    </Card>
  )
}
