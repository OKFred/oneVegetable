<script setup lang="ts">
import { LogOut, Settings } from '@lucide/vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui';
import { useUiI18n } from '../i18n';
import { Avatar, AvatarFallback } from './ui/avatar';
import Button from './ui/Button.vue';

defineProps<{ name: string; initials: string; canLogout: boolean }>();
const emit = defineEmits<{ logout: [] }>();
const { t } = useUiI18n();
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="rounded-full"
        data-testid="account-menu-trigger"
        :title="name"
        :aria-label="t('shell.identity.avatarLabel', { name })"
      >
        <Avatar class="border border-border bg-card text-foreground shadow-sm">
          <AvatarFallback class="bg-primary text-xs text-primary-foreground">{{ initials }}</AvatarFallback>
        </Avatar>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="6"
        class="ov-dropdown-content z-[90] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
      >
        <p class="max-w-56 truncate border-b px-3 py-2 text-xs text-muted-foreground">{{ name }}</p>
        <DropdownMenuItem as-child>
          <a
            href="#/settings"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent"
            ><Settings class="size-4" />{{ t('shell.navigation.settings') }}</a
          >
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="canLogout"
          class="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent"
          @select="emit('logout')"
          ><LogOut class="size-4" />{{ t('shell.logout') }}</DropdownMenuItem
        >
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
