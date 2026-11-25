/**
 * Database row types, hand-written to match supabase/migrations.
 * If you regenerate with `supabase gen types typescript`, replace this file.
 */

export interface ProfileRow {
  id: string;
  display_name: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface PersonRow {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  birthday: string | null;
  birthday_year_known: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type GeneralPreferenceType = "like" | "dislike";

export interface PersonPreferenceRow {
  id: string;
  user_id: string;
  person_id: string;
  preference_type: GeneralPreferenceType;
  value: string;
  notes: string | null;
  created_at: string;
}

export type Recurrence = "none" | "yearly";

export interface ImportantDateRow {
  id: string;
  user_id: string;
  title: string;
  event_date: string;
  year_known: boolean;
  recurrence: Recurrence;
  person_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type RelatedEntityType =
  | "person"
  | "important_date"
  | "document"
  | "recipe"
  | "note"
  | "food_preference";

export interface ReminderRow {
  id: string;
  user_id: string;
  title: string;
  remind_at: string;
  completed: boolean;
  related_entity_type: RelatedEntityType | null;
  related_entity_id: string | null;
  created_at: string;
  updated_at: string;
}

export type FoodPreferenceType = "like" | "dislike" | "allergy" | "dietary_restriction";
export type AllergySeverity = "mild" | "moderate" | "severe";

export interface FoodPreferenceRow {
  id: string;
  user_id: string;
  person_id: string | null;
  food_name: string;
  preference_type: FoodPreferenceType;
  severity: AllergySeverity | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  preparation_time_minutes: number | null;
  cooking_time_minutes: number | null;
  servings: number | null;
  instructions: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredientRow {
  id: string;
  recipe_id: string;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  optional: boolean;
  notes: string | null;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  document_type: string;
  display_name: string;
  document_number: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  issuing_country: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteType = "idea" | "memory" | "general" | "place" | "gift_idea";

export interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  content: string;
  note_type: NoteType;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type ProcessingStatus = "pending" | "analyzed" | "confirmed" | "discarded" | "failed";

export interface InboxEntryRow {
  id: string;
  user_id: string;
  original_text: string;
  processing_status: ProcessingStatus;
  extracted_json: unknown;
  created_at: string;
}

export interface EntityLinkRow {
  id: string;
  user_id: string;
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  relationship_type: string;
  created_at: string;
}
