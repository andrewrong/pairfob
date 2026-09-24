<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import { switchDocsLanguage } from "./lang-switch";

const { lang } = useData();
const zh = computed(() => lang.value.startsWith("zh"));

const go = switchDocsLanguage;
</script>

<template>
  <nav class="pf-lang" :aria-label="zh ? '语言' : 'Language'">
    <button type="button" class="pf-lang-btn" lang="zh-CN" :aria-current="zh ? 'page' : undefined" @click="go('zh')">
      中文
    </button>
    <button type="button" class="pf-lang-btn" lang="en" :aria-current="!zh ? 'page' : undefined" @click="go('en')">
      EN
    </button>
  </nav>
  <a class="pf-nav-link" :href="zh ? '/zh/' : '/'" target="_self">{{ zh ? "首页" : "Home" }}</a>
  <a
    class="pf-nav-link"
    href="https://github.com/arronKler/pairfob/issues/new"
    target="_blank"
    rel="noreferrer"
  >{{ zh ? "反馈" : "Feedback" }}</a>
  <a class="pf-nav-app" href="/pair" target="_self">{{ zh ? "打开 Pairfob" : "Open Pairfob" }}</a>
</template>
