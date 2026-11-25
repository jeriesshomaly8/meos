/**
 * Development seed script.
 *
 * Creates (or reuses) a dev user and fills their account with realistic,
 * clearly fictional data. Requires the service-role key, so it must only ever
 * run against a development project — never production.
 *
 * Usage:  npm run seed
 * Login:  seed@meos.dev / meos-dev-password
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SEED_EMAIL = "seed@meos.dev";
const SEED_PASSWORD = "meos-dev-password";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local — see README.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findOrCreateSeedUser(): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Jerie (dev)" },
  });
  if (created?.user) return created.user.id;

  // Already exists — look it up.
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === SEED_EMAIL);
  if (!existing) throw error ?? new Error("Could not create or find seed user");
  return existing.id;
}

async function main() {
  const userId = await findOrCreateSeedUser();
  console.log(`Seeding data for ${SEED_EMAIL} (${userId})`);

  // Idempotent: wipe the seed user's data first.
  const { error: wipeError } = await admin.rpc("delete_all_my_data");
  if (wipeError) {
    // delete_all_my_data is invoker-scoped; as service role just delete directly.
    for (const table of [
      "entity_links",
      "reminders",
      "person_preferences",
      "food_preferences",
      "important_dates",
      "recipes",
      "documents",
      "notes",
      "people",
      "inbox_entries",
    ]) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`wipe ${table}: ${error.message}`);
    }
  }

  const insert = async <T extends { id: string }>(
    table: string,
    row: Record<string, unknown>,
  ): Promise<T> => {
    const { data, error } = await admin.from(table).insert(row).select().single();
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    return data as T;
  };

  const sarah = await insert<{ id: string }>("people", {
    user_id: userId,
    name: "Sarah",
    relationship: "friend",
    birthday: "2000-09-22", // sentinel year 2000 — year not actually known
    birthday_year_known: false,
    notes: "Loves white flowers.",
  });

  const sarahBirthday = await insert<{ id: string }>("important_dates", {
    user_id: userId,
    title: "Sarah's birthday",
    event_date: "2000-09-22",
    year_known: false,
    recurrence: "yearly",
    person_id: sarah.id,
  });

  await insert("person_preferences", {
    user_id: userId,
    person_id: sarah.id,
    preference_type: "like",
    value: "white flowers",
  });

  await insert("food_preferences", {
    user_id: userId,
    person_id: sarah.id,
    food_name: "mushrooms",
    preference_type: "dislike",
  });

  await insert("food_preferences", {
    user_id: userId,
    person_id: sarah.id,
    food_name: "vegetarian",
    preference_type: "dietary_restriction",
    notes: "No meat or fish.",
  });

  const carbonara = await insert<{ id: string }>("recipes", {
    user_id: userId,
    name: "Spaghetti Carbonara",
    description: "Classic Roman pasta — eggs, cheese, guanciale, pepper. No cream.",
    preparation_time_minutes: 10,
    cooking_time_minutes: 15,
    servings: 2,
    instructions: [
      "Bring a large pot of salted water to a boil and cook the spaghetti until al dente.",
      "Meanwhile, cut the guanciale into small strips and render it slowly in a cold pan until crisp.",
      "Whisk the eggs with the grated Pecorino and plenty of black pepper.",
      "Drain the pasta, reserving a cup of cooking water.",
      "Off the heat, toss the pasta with the guanciale, then stir in the egg mixture, loosening with pasta water until glossy.",
      "Serve immediately with extra Pecorino and pepper.",
    ].join("\n"),
  });

  const ingredients = [
    { ingredient_name: "spaghetti", quantity: 200, unit: "g" },
    { ingredient_name: "guanciale", quantity: 100, unit: "g", notes: "pancetta works too" },
    { ingredient_name: "eggs", quantity: 2, unit: "whole" },
    { ingredient_name: "egg yolk", quantity: 1, unit: "whole" },
    { ingredient_name: "Pecorino Romano", quantity: 50, unit: "g" },
    { ingredient_name: "black pepper", quantity: 1, unit: "tsp" },
    { ingredient_name: "salt", quantity: null, unit: null, notes: "for the pasta water" },
  ];
  for (const ing of ingredients) {
    const { error } = await admin
      .from("recipe_ingredients")
      .insert({ recipe_id: carbonara.id, optional: false, ...ing });
    if (error) throw new Error(`insert recipe_ingredients: ${error.message}`);
  }

  const passport = await insert<{ id: string }>("documents", {
    user_id: userId,
    document_type: "passport",
    display_name: "Passport",
    document_number: "X0000000", // clearly fictional
    issue_date: "2018-05-14",
    expiration_date: "2028-05-14",
    issuing_country: "Israel",
  });

  const renewal = await insert<{ id: string }>("reminders", {
    user_id: userId,
    title: "Renew passport",
    remind_at: "2027-11-14T09:00:00Z", // six months before expiration
    completed: false,
    related_entity_type: "document",
    related_entity_id: passport.id,
  });

  await insert("notes", {
    user_id: userId,
    title: "Gift idea for Sarah",
    content: "A bouquet of white flowers — she mentioned loving them.",
    note_type: "gift_idea",
    pinned: true,
  });

  await insert("notes", {
    user_id: userId,
    title: "Weekend trip idea",
    content: "Try the new hiking trail up north; best in spring when everything blooms.",
    note_type: "idea",
  });

  const links = [
    {
      source_entity_type: "important_date",
      source_entity_id: sarahBirthday.id,
      target_entity_type: "person",
      target_entity_id: sarah.id,
      relationship_type: "about",
    },
    {
      source_entity_type: "reminder",
      source_entity_id: renewal.id,
      target_entity_type: "document",
      target_entity_id: passport.id,
      relationship_type: "about",
    },
  ];
  for (const link of links) {
    const { error } = await admin.from("entity_links").insert({ user_id: userId, ...link });
    if (error) throw new Error(`insert entity_links: ${error.message}`);
  }

  console.log("Seed complete.");
  console.log(`Sign in with ${SEED_EMAIL} / ${SEED_PASSWORD}`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
