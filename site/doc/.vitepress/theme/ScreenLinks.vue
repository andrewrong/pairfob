<script setup lang="ts">
// Language, Home and Feedback for the hamburger screen. On narrow widths the
// navbar keeps only Open Pairfob beside the title, search and menu button (all
// that fits on a phone), so these move here.
import { computed } from "vue";
import { useData } from "vitepress";
import { switchDocsLanguage } from "./lang-switch";

const { lang } = useData();
const zh = computed(() => lang.value.startsWith("zh"));
</script>

<template>
  <div class="pf-screen-lang" role="group" :aria-label="zh ? '语言' : 'Language'">
    <button type="button" class="pf-lang-btn" lang="zh-CN" :aria-current="zh ? 'page' : undefined" @click="switchDocsLanguage('zh')">
      中文
    </button>
    <button type="button" class="pf-lang-btn" lang="en" :aria-current="!zh ? 'page' : undefined" @click="switchDocsLanguage('en')">
      EN
    </button>
  </div>
  <nav class="pf-screen-links" :aria-label="zh ? 'Pairfob 站点' : 'Pairfob site'">
    <a :href="zh ? '/zh/' : '/'" target="_self">{{ zh ? "首页" : "Home" }}</a>
    <a href="https://github.com/arronKler/pairfob/issues/new" target="_blank" rel="noreferrer">{{
      zh ? "反馈" : "Feedback"
    }}</a>
  </nav>
</template>
