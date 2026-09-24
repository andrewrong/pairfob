<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";

type Node = {
  k: string;
  title: string;
  detail: string;
  hop?: string;
  chain?: string[];
};

const { lang } = useData();
const zh = computed(() => lang.value.startsWith("zh"));

// P2P is the preferred path; the relay is the fallback (docs security.md).
const copy = computed(() =>
  zh.value
    ? {
        aria: "会话从另一台设备到你的电脑：优先直连，连不上时经 pairfob.com 中转",
        nodes: [
          {
            k: "设备",
            title: "另一台设备上的 Pairfob",
            detail: "手机、平板或另一台电脑。密钥在这一端。",
            hop: "P2P 直连 · 密文 · 默认优先",
          },
          {
            k: "电脑",
            title: "你电脑上的 pairfob",
            detail: "接到 Herdr，再接到那些 CLI。",
            chain: ["pairfob", "Herdr", "CLI"],
          },
        ],
        fallback: {
          k: "直连不通时",
          title: "经 pairfob.com 中转",
          detail: "只转发密文，不看内容，不跑 agent。中转也负责帮两边找到对方。",
        },
      }
    : {
        aria: "A session travels from another device to your computer: direct first, through pairfob.com when direct fails",
        nodes: [
          {
            k: "Device",
            title: "Pairfob on another device",
            detail: "Phone, tablet, or another computer. Keys stay here.",
            hop: "P2P direct · ciphertext · preferred",
          },
          {
            k: "Computer",
            title: "pairfob on your computer",
            detail: "Talks to Herdr, then to those CLIs.",
            chain: ["pairfob", "Herdr", "CLI"],
          },
        ],
        fallback: {
          k: "If direct fails",
          title: "Through the pairfob.com relay",
          detail: "Forwards ciphertext only. Does not read content or run agents. It also helps the two sides find each other.",
        },
      },
);
</script>

<template>
  <div class="pf-path" :aria-label="copy.aria" role="group">
  <ol class="pf-rail">
    <li v-for="n in copy.nodes" :key="n.k">
      <p class="k">{{ n.k }}</p>
      <p class="t">{{ n.title }}</p>
      <p class="d">{{ n.detail }}</p>
      <p v-if="n.chain" class="chain">
        <span v-for="step in n.chain" :key="step">{{ step }}</span>
      </p>
      <p v-if="n.hop" class="hop">{{ n.hop }}</p>
    </li>
  </ol>
  <div class="pf-fallback">
    <p class="k">{{ copy.fallback.k }}</p>
    <p class="t">{{ copy.fallback.title }}</p>
    <p class="d">{{ copy.fallback.detail }}</p>
  </div>
  </div>
</template>

<style scoped>
.pf-path {
  margin: 24px 0 4px;
}

.pf-rail {
  list-style: none;
  margin: 0;
  padding: 4px 0 2px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.pf-rail li {
  position: relative;
  margin: 0;
  padding: 14px 20px 2px 44px;
}

.pf-rail li:last-child {
  padding-bottom: 18px;
}

.pf-rail li::before {
  content: "";
  position: absolute;
  left: 18px;
  top: 20px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 50%;
  background: var(--vp-c-bg-alt);
}

.pf-rail li:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 22px;
  top: 31px;
  bottom: 0;
  width: 1px;
  background: var(--vp-c-divider);
}

.k {
  margin: 0 0 2px;
  color: var(--vp-c-text-2);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.t {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 650;
  line-height: 1.35;
}

.d {
  margin: 4px 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.88rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
}

.chain span:not(:last-child)::after {
  content: "→";
  margin-left: 6px;
  color: var(--vp-c-text-3);
}

.pf-fallback {
  margin-top: 8px;
  padding: 12px 20px 14px 44px;
  border: 1px dashed var(--vp-c-border);
}

.pf-fallback .t {
  color: var(--vp-c-text-2);
  font-weight: 600;
}

.hop {
  margin: 10px 0 8px;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.06em;
}
</style>
