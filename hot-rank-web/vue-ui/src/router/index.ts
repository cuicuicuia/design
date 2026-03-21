import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/workflow',
      name: 'workflow',
      component: () => import('../views/WorkflowView.vue'),
      meta: { title: 'AI 工作流' },
    },
    {
      path: '/workflows',
      name: 'workflows',
      component: () => import('../views/WorkflowListView.vue'),
      meta: { title: '工作流列表' },
    },
    {
      path: '/ai-monitor',
      name: 'ai-monitor',
      component: () => import('../views/AiMonitorView.vue'),
      meta: { title: 'AI 调用监控' },
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
