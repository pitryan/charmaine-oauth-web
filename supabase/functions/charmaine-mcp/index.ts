import "@supabase/functions-js/edge-runtime.d.ts";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { pipeline } from "@supabase/middleware";

import { withOAuthProtectedResource, withSupabase } from "@supabase/server";

import { z } from "zod";

import { createMemory, createMemorySchema } from "./create_memory.ts";
import { listMemories, listMemoriesSchema } from "./list_memories.ts";
import { presentMemory } from "./memory_output.ts";
import { promoteMemory, promoteMemorySchema } from "./promote_memory.ts";

Deno.serve(
  pipeline(
    [
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "charmaine-mcp",
          version: "0.3.0",
        });

        // Tool pertama: tes koneksi
        server.registerTool(
          "ping",
          {
            description: "Tes koneksi MCP Charmaine.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          () => ({
            content: [
              {
                type: "text",
                text: "MCP Charmaine aktif!",
              },
            ],
          }),
        );

        // Tool kedua: cari ingatan Charmaine
        server.registerTool(
          "search_memories",
          {
            description: "Cari ingatan Charmaine berdasarkan isi cerita. " +
              "Hanya membaca memori yang diizinkan RLS. " +
              "Bisa dibatasi ke draft atau canon; status selalu dipertahankan.",
            inputSchema: z.object({
              query: z.string().trim().min(2).max(100),
              canon_status: z.enum(["draft", "canon"]).optional(),
              memory_type: z.enum(["event", "fact", "plan", "state"])
                .optional(),
              limit: z.number().int().min(1).max(10).default(5),
            }),
            annotations: { readOnlyHint: true },
          },
          async ({ query, canon_status, memory_type, limit }) => {
            // Menggunakan client OAuth milik pengguna.
            // RLS tetap berlaku.
            let search = supabase
              .from("charmaine_memories")
              .select(
                "memory_key,title,memory_text,period," +
                  "school_year,event_year,category,origin," +
                  "canon_status,clarity,details",
              )
              .ilike("memory_text", `%${query}%`)
              .order("created_at", { ascending: false })
              .limit(limit);

            if (canon_status) {
              search = search.eq("canon_status", canon_status);
            }

            if (memory_type) {
              search = search.eq("details->>memory_type", memory_type);
            }

            const { data, error } = await search;

            if (error) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: `Pencarian gagal: ${error.message}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    count: data?.length ?? 0,
                    memories: (data ?? []).map((row) => presentMemory(row)),
                  }),
                },
              ],
            };
          },
        );

        server.registerTool(
          "list_memories",
          {
            description: "Ambil daftar ingatan Charmaine berdasarkan status, " +
              "periode hidup, tahun kejadian, kategori, atau tahun ajaran. " +
              "Hanya membaca memori yang diizinkan RLS; total mengikuti " +
              "filter sebelum pagination.",
            inputSchema: listMemoriesSchema,
            annotations: { readOnlyHint: true },
          },
          (args) => listMemories(supabase, args),
        );

        server.registerTool(
          "create_memory",
          {
            description: "Simpan memori baru sebagai draft. Tool ini tidak " +
              "dapat membuat canon atau menentukan owner; kepemilikan berasal " +
              "dari sesi OAuth dan tetap dibatasi RLS.",
            inputSchema: createMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          (args) => createMemory(supabase, args),
        );

        server.registerTool(
          "promote_memory",
          {
            description:
              "Jadikan memori draft sebagai canon setelah pengguna " +
              "mengonfirmasi bahwa fakta atau kejadian tersebut benar. Hanya " +
              "memori milik sesi OAuth yang dapat dipromosikan.",
            inputSchema: promoteMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          (args) => promoteMemory(supabase, args),
        );

        return server;
      });

      return await handler.fetch(req);
    },
  ),
);
